pub mod executor;
pub mod node_registry;
pub mod nodes;
pub mod scheduler;
pub mod state_machine;

use crate::errors::{AppError, Result};
use crate::models::workflow::{Workflow, WorkflowExecution};
use executor::{RetryPolicy, WorkflowExecutionResult};
use node_registry::{build_default_registry, ClaudeProvider, NodeRegistry, ServiceProvider};
use scheduler::Scheduler;
use state_machine::WorkflowState;

use sqlx::sqlite::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

/// The top-level workflow engine that orchestrates everything.
pub struct WorkflowEngine {
    registry: NodeRegistry,
    scheduler: Scheduler,
    db_pool: Arc<RwLock<Option<SqlitePool>>>,
    services: Arc<RwLock<Option<ServiceProvider>>>,
    retry_policy: RetryPolicy,
}

#[allow(dead_code)]
impl WorkflowEngine {
    pub fn new() -> Self {
        Self {
            registry: build_default_registry(),
            scheduler: Scheduler::new(),
            db_pool: Arc::new(RwLock::new(None)),
            services: Arc::new(RwLock::new(None)),
            retry_policy: RetryPolicy::default(),
        }
    }

    /// Initialize the engine with a database pool and service references.
    pub async fn initialize(
        &self,
        pool: SqlitePool,
        github: Arc<crate::services::GitHubClient>,
        git: Arc<crate::services::GitService>,
    ) {
        *self.db_pool.write().await = Some(pool);
        *self.services.write().await = Some(ServiceProvider {
            github,
            claude: Arc::new(ClaudeProvider::new()),
            git,
        });
    }

    /// Check if the engine has been initialized with a database and services.
    pub async fn is_initialized(&self) -> bool {
        self.db_pool.read().await.is_some() && self.services.read().await.is_some()
    }

    // ----- Database operations -----

    async fn get_pool(&self) -> Result<SqlitePool> {
        self.db_pool
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Database {
                code: crate::errors::types::ErrorCode::DatabaseNotInitialized.as_str(),
                message: "Database not initialized".to_string(),
            })
    }

    pub async fn list_workflows(&self) -> Result<Vec<Workflow>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query_as::<_, WorkflowRow>(
            "SELECT id, name, description, nodes, edges, config, version, created_at, updated_at FROM workflows ORDER BY updated_at DESC",
        )
        .fetch_all(&pool)
        .await?;

        rows.into_iter().map(|r| r.into_workflow()).collect()
    }

    pub async fn get_workflow(&self, id: &str) -> Result<Option<Workflow>> {
        let pool = self.get_pool().await?;
        let row = sqlx::query_as::<_, WorkflowRow>(
            "SELECT id, name, description, nodes, edges, config, version, created_at, updated_at FROM workflows WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&pool)
        .await?;

        match row {
            Some(r) => Ok(Some(r.into_workflow()?)),
            None => Ok(None),
        }
    }

    pub async fn create_workflow(&self, workflow: &Workflow) -> Result<Workflow> {
        let pool = self.get_pool().await?;
        let nodes_json = serde_json::to_string(&workflow.nodes)?;
        let edges_json = serde_json::to_string(&workflow.edges)?;
        let config_json = workflow
            .config
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            "INSERT INTO workflows (id, name, description, nodes, edges, config, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&workflow.id)
        .bind(&workflow.name)
        .bind(&workflow.description)
        .bind(&nodes_json)
        .bind(&edges_json)
        .bind(&config_json)
        .bind(workflow.version)
        .bind(&workflow.created_at)
        .bind(&workflow.updated_at)
        .execute(&pool)
        .await?;

        Ok(workflow.clone())
    }

    pub async fn update_workflow(&self, id: &str, workflow: &Workflow) -> Result<Workflow> {
        let pool = self.get_pool().await?;
        let nodes_json = serde_json::to_string(&workflow.nodes)?;
        let edges_json = serde_json::to_string(&workflow.edges)?;
        let config_json = workflow
            .config
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE workflows SET name = ?, description = ?, nodes = ?, edges = ?, config = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .bind(&workflow.name)
        .bind(&workflow.description)
        .bind(&nodes_json)
        .bind(&edges_json)
        .bind(&config_json)
        .bind(&now)
        .bind(id)
        .execute(&pool)
        .await?;

        self.get_workflow(id)
            .await?
            .ok_or_else(|| AppError::Validation(format!("Workflow {} not found", id)))
    }

    pub async fn delete_workflow(&self, id: &str) -> Result<()> {
        let pool = self.get_pool().await?;
        sqlx::query("DELETE FROM workflows WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await?;
        Ok(())
    }

    // ----- Execution operations -----

    /// Execute a workflow by ID.
    pub async fn execute_workflow(
        &self,
        workflow_id: &str,
        trigger_type: Option<&str>,
    ) -> Result<WorkflowExecutionResult> {
        let workflow = self
            .get_workflow(workflow_id)
            .await?
            .ok_or_else(|| AppError::Validation(format!("Workflow {} not found", workflow_id)))?;

        let services = self.services.read().await;
        let services = services
            .as_ref()
            .ok_or_else(|| AppError::Unknown("Engine not initialized with services".into()))?;

        let execution_id = uuid::Uuid::new_v4().to_string();

        // Record execution start in database
        self.record_execution_start(&execution_id, workflow_id, trigger_type.unwrap_or("manual"))
            .await?;

        // Run the DAG executor
        let result = executor::execute_workflow(
            &execution_id,
            &workflow,
            &self.registry,
            services,
            &self.retry_policy,
        )
        .await;

        // Record execution completion
        self.record_execution_complete(&result).await?;

        Ok(result)
    }

    /// Record the start of a workflow execution in the database.
    async fn record_execution_start(
        &self,
        execution_id: &str,
        workflow_id: &str,
        trigger_type: &str,
    ) -> Result<()> {
        let pool = self.get_pool().await?;
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO executions (id, workflow_id, status, trigger_type, started_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(execution_id)
        .bind(workflow_id)
        .bind(WorkflowState::Running.as_str())
        .bind(trigger_type)
        .bind(&now)
        .execute(&pool)
        .await?;

        Ok(())
    }

    /// Record the completion of a workflow execution.
    async fn record_execution_complete(&self, result: &WorkflowExecutionResult) -> Result<()> {
        let pool = self.get_pool().await?;
        let context_json = serde_json::to_string(&result.node_results)?;

        sqlx::query(
            "UPDATE executions SET status = ?, completed_at = ?, error = ?, context = ? WHERE id = ?",
        )
        .bind(&result.status)
        .bind(&result.completed_at)
        .bind(&result.error)
        .bind(&context_json)
        .bind(&result.execution_id)
        .execute(&pool)
        .await?;

        // Also record individual node executions
        for node_result in &result.node_results {
            let output_json = node_result
                .output
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;
            let node_exec_id = uuid::Uuid::new_v4().to_string();

            sqlx::query(
                "INSERT INTO node_executions (id, execution_id, node_id, status, output, error, started_at, completed_at, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&node_exec_id)
            .bind(&result.execution_id)
            .bind(&node_result.node_id)
            .bind(&node_result.status)
            .bind(&output_json)
            .bind(&node_result.error)
            .bind(&node_result.started_at)
            .bind(&node_result.completed_at)
            .bind(node_result.retry_count as i32)
            .execute(&pool)
            .await?;
        }

        Ok(())
    }

    /// List workflow executions, optionally filtered by workflow_id.
    pub async fn list_executions(
        &self,
        workflow_id: Option<&str>,
    ) -> Result<Vec<WorkflowExecution>> {
        let pool = self.get_pool().await?;
        let rows = if let Some(wf_id) = workflow_id {
            sqlx::query_as::<_, ExecutionRow>(
                "SELECT id, workflow_id, status, trigger_type, started_at, completed_at, error, context, current_node_id FROM executions WHERE workflow_id = ? ORDER BY started_at DESC",
            )
            .bind(wf_id)
            .fetch_all(&pool)
            .await?
        } else {
            sqlx::query_as::<_, ExecutionRow>(
                "SELECT id, workflow_id, status, trigger_type, started_at, completed_at, error, context, current_node_id FROM executions ORDER BY started_at DESC",
            )
            .fetch_all(&pool)
            .await?
        };

        Ok(rows.into_iter().map(|r| r.into_execution()).collect())
    }

    /// Get execution logs for a specific execution.
    pub async fn get_execution_logs(
        &self,
        execution_id: &str,
    ) -> Result<Vec<crate::commands::workflow::ExecutionLogEntry>> {
        let pool = self.get_pool().await?;
        let rows = sqlx::query_as::<_, ExecutionLogRow>(
            "SELECT id, execution_id, node_id, level, message, metadata, timestamp FROM execution_logs WHERE execution_id = ? ORDER BY timestamp ASC",
        )
        .bind(execution_id)
        .fetch_all(&pool)
        .await?;

        Ok(rows.into_iter().map(|r| r.into_entry()).collect())
    }

    /// Get the scheduler for registering triggers.
    pub fn scheduler(&self) -> &Scheduler {
        &self.scheduler
    }

    /// Expose the database pool handle for external initialization.
    pub fn db_pool_handle(&self) -> Arc<RwLock<Option<SqlitePool>>> {
        Arc::clone(&self.db_pool)
    }

    /// Expose the services handle for external initialization.
    pub fn services_handle(&self) -> Arc<RwLock<Option<ServiceProvider>>> {
        Arc::clone(&self.services)
    }
}

// ----- SQLx row types -----

#[derive(sqlx::FromRow)]
struct WorkflowRow {
    id: String,
    name: String,
    description: Option<String>,
    nodes: String,
    edges: String,
    config: Option<String>,
    version: i32,
    created_at: String,
    updated_at: String,
}

impl WorkflowRow {
    fn into_workflow(self) -> Result<Workflow> {
        let nodes = serde_json::from_str(&self.nodes)?;
        let edges = serde_json::from_str(&self.edges)?;
        let config = self.config.map(|c| serde_json::from_str(&c)).transpose()?;

        Ok(Workflow {
            id: self.id,
            name: self.name,
            description: self.description,
            nodes,
            edges,
            config,
            version: self.version,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

#[derive(sqlx::FromRow)]
struct ExecutionRow {
    id: String,
    workflow_id: String,
    status: String,
    trigger_type: Option<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
    error: Option<String>,
    context: Option<String>,
    current_node_id: Option<String>,
}

impl ExecutionRow {
    fn into_execution(self) -> WorkflowExecution {
        let context = self.context.and_then(|c| serde_json::from_str(&c).ok());

        WorkflowExecution {
            id: self.id,
            workflow_id: self.workflow_id,
            status: self.status,
            trigger_type: self.trigger_type,
            started_at: self.started_at,
            completed_at: self.completed_at,
            error: self.error,
            context,
            current_node_id: self.current_node_id,
        }
    }
}

#[derive(sqlx::FromRow)]
struct ExecutionLogRow {
    id: i64,
    execution_id: String,
    node_id: Option<String>,
    level: String,
    message: String,
    metadata: Option<String>,
    timestamp: String,
}

impl ExecutionLogRow {
    fn into_entry(self) -> crate::commands::workflow::ExecutionLogEntry {
        let metadata = self.metadata.and_then(|m| serde_json::from_str(&m).ok());

        crate::commands::workflow::ExecutionLogEntry {
            id: self.id,
            execution_id: self.execution_id,
            node_id: self.node_id,
            level: self.level,
            message: self.message,
            metadata,
            timestamp: self.timestamp,
        }
    }
}
