pub mod executor;
pub mod node_registry;
pub mod nodes;
pub mod preflight;
pub mod scheduler;
pub mod state_machine;

use crate::errors::{AppError, Result};
use crate::models::workflow::{Workflow, WorkflowExecution};
use executor::{RetryPolicy, WorkflowExecutionResult};
use node_registry::{build_default_registry, ClaudeProvider, NodeRegistry, ServiceProvider};
use preflight::WorkflowPreflightResult;
use scheduler::{ScheduledWorkflow, Scheduler};
use serde_json::json;
use state_machine::WorkflowState;

use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

struct RunningExecution {
    workflow_id: String,
    cancellation_flag: Arc<AtomicBool>,
}

struct ExecutionLogInsert<'a> {
    execution_id: &'a str,
    node_id: Option<&'a str>,
    level: &'a str,
    message: &'a str,
    metadata: Option<serde_json::Value>,
    timestamp: &'a str,
}

/// The top-level workflow engine that orchestrates everything.
pub struct WorkflowEngine {
    registry: Arc<NodeRegistry>,
    scheduler: Scheduler,
    db_pool: Arc<RwLock<Option<SqlitePool>>>,
    services: Arc<RwLock<Option<ServiceProvider>>>,
    retry_policy: RetryPolicy,
    running_executions: Arc<RwLock<HashMap<String, RunningExecution>>>,
    scheduler_started: Arc<AtomicBool>,
}

#[allow(dead_code)]
impl WorkflowEngine {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(build_default_registry()),
            scheduler: Scheduler::new(),
            db_pool: Arc::new(RwLock::new(None)),
            services: Arc::new(RwLock::new(None)),
            retry_policy: RetryPolicy::default(),
            running_executions: Arc::new(RwLock::new(HashMap::new())),
            scheduler_started: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Initialize the engine with a database pool and service references.
    pub async fn initialize(
        &self,
        pool: SqlitePool,
        github: Arc<crate::services::GitHubClient>,
        storage: Arc<crate::services::StorageService>,
        git: Arc<crate::services::GitService>,
    ) {
        *self.db_pool.write().await = Some(pool);
        *self.services.write().await = Some(ServiceProvider {
            github,
            storage,
            claude: Arc::new(ClaudeProvider::new()),
            git,
            backlog: Arc::new(crate::services::BacklogService::new(self.db_pool_handle())),
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
            "SELECT id, name, description, status, nodes, edges, config, version, created_at, updated_at FROM workflows ORDER BY updated_at DESC",
        )
        .fetch_all(&pool)
        .await?;

        rows.into_iter().map(|r| r.into_workflow()).collect()
    }

    pub async fn get_workflow(&self, id: &str) -> Result<Option<Workflow>> {
        let pool = self.get_pool().await?;
        let row = sqlx::query_as::<_, WorkflowRow>(
            "SELECT id, name, description, status, nodes, edges, config, version, created_at, updated_at FROM workflows WHERE id = ?",
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
        let workflow_status = if workflow.status.trim().is_empty() {
            "draft"
        } else {
            workflow.status.as_str()
        };
        let nodes_json = serde_json::to_string(&workflow.nodes)?;
        let edges_json = serde_json::to_string(&workflow.edges)?;
        let config_json = workflow
            .config
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            "INSERT INTO workflows (id, name, description, status, nodes, edges, config, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&workflow.id)
        .bind(&workflow.name)
        .bind(&workflow.description)
        .bind(workflow_status)
        .bind(&nodes_json)
        .bind(&edges_json)
        .bind(&config_json)
        .bind(workflow.version)
        .bind(&workflow.created_at)
        .bind(&workflow.updated_at)
        .execute(&pool)
        .await?;

        self.scheduler
            .sync_workflow_schedule(&pool, workflow)
            .await?;

        Ok(workflow.clone())
    }

    pub async fn update_workflow(&self, id: &str, workflow: &Workflow) -> Result<Workflow> {
        let pool = self.get_pool().await?;
        let workflow_status = if workflow.status.trim().is_empty() {
            "draft"
        } else {
            workflow.status.as_str()
        };
        let nodes_json = serde_json::to_string(&workflow.nodes)?;
        let edges_json = serde_json::to_string(&workflow.edges)?;
        let config_json = workflow
            .config
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "UPDATE workflows SET name = ?, description = ?, status = ?, nodes = ?, edges = ?, config = ?, version = version + 1, updated_at = ? WHERE id = ?",
        )
        .bind(&workflow.name)
        .bind(&workflow.description)
        .bind(workflow_status)
        .bind(&nodes_json)
        .bind(&edges_json)
        .bind(&config_json)
        .bind(&now)
        .bind(id)
        .execute(&pool)
        .await?;

        let updated = self
            .get_workflow(id)
            .await?
            .ok_or_else(|| AppError::Validation(format!("Workflow {} not found", id)))?;
        self.scheduler
            .sync_workflow_schedule(&pool, &updated)
            .await?;
        Ok(updated)
    }

    pub async fn delete_workflow(&self, id: &str) -> Result<()> {
        let pool = self.get_pool().await?;
        let mut tx = pool.begin().await?;

        // Keep deletes robust across existing DBs even if FK cascade behavior differs.
        sqlx::query(
            "DELETE FROM execution_logs WHERE execution_id IN (SELECT id FROM executions WHERE workflow_id = ?)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "DELETE FROM node_executions WHERE execution_id IN (SELECT id FROM executions WHERE workflow_id = ?)",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM executions WHERE workflow_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        sqlx::query(
            "UPDATE backlog_items SET linked_workflow_id = NULL WHERE linked_workflow_id = ?",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM workflows WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        self.scheduler.remove_workflow_schedule(&pool, id).await?;
        Ok(())
    }

    // ----- Execution operations -----

    /// Run static/dynamic preflight checks for a workflow definition.
    pub async fn preflight_workflow(&self, workflow: &Workflow) -> Result<WorkflowPreflightResult> {
        let services = self.services.read().await;
        Ok(preflight::run_preflight(workflow, self.registry.as_ref(), services.as_ref()).await)
    }

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
            self.registry.as_ref(),
            services,
            &self.retry_policy,
        )
        .await;

        // Record execution completion
        self.record_execution_complete(&result).await?;

        Ok(result)
    }

    /// Start workflow execution asynchronously and return the execution record immediately.
    pub async fn start_workflow_execution(
        self: &Arc<Self>,
        workflow_id: &str,
        trigger_type: Option<&str>,
    ) -> Result<WorkflowExecution> {
        if self.is_workflow_running(workflow_id).await {
            return Err(AppError::Validation(format!(
                "Workflow {} is already running",
                workflow_id
            )));
        }

        let workflow = self
            .get_workflow(workflow_id)
            .await?
            .ok_or_else(|| AppError::Validation(format!("Workflow {} not found", workflow_id)))?;

        let services = {
            let services_guard = self.services.read().await;
            services_guard
                .as_ref()
                .ok_or_else(|| AppError::Unknown("Engine not initialized with services".into()))?
                .clone()
        };

        let execution_id = uuid::Uuid::new_v4().to_string();
        let trigger = trigger_type.unwrap_or("manual");
        let started_at = self
            .record_execution_start(&execution_id, workflow_id, trigger)
            .await?;

        let cancellation_flag = Arc::new(AtomicBool::new(false));
        self.running_executions.write().await.insert(
            execution_id.clone(),
            RunningExecution {
                workflow_id: workflow_id.to_string(),
                cancellation_flag: Arc::clone(&cancellation_flag),
            },
        );

        let engine = Arc::clone(self);
        let execution_id_for_task = execution_id.clone();
        tokio::spawn(async move {
            let result = executor::execute_workflow_cancellable(
                &execution_id_for_task,
                &workflow,
                engine.registry.as_ref(),
                &services,
                &engine.retry_policy,
                cancellation_flag,
            )
            .await;

            if let Err(error) = engine.record_execution_complete(&result).await {
                log::error!(
                    "[Workflow:{}] [Execution:{}] Failed to persist completion: {}",
                    result.workflow_id,
                    result.execution_id,
                    error
                );
            }

            engine
                .running_executions
                .write()
                .await
                .remove(&execution_id_for_task);
        });

        Ok(WorkflowExecution {
            id: execution_id,
            workflow_id: workflow_id.to_string(),
            status: WorkflowState::Running.as_str().to_string(),
            trigger_type: Some(trigger.to_string()),
            started_at: Some(started_at),
            completed_at: None,
            error: None,
            context: None,
            current_node_id: None,
        })
    }

    pub async fn cancel_workflow_execution(&self, execution_id: &str) -> Result<()> {
        let running = self.running_executions.read().await;
        let entry = running.get(execution_id).ok_or_else(|| {
            AppError::Validation(format!(
                "Workflow execution {} is not running",
                execution_id
            ))
        })?;
        entry.cancellation_flag.store(true, Ordering::Relaxed);
        let workflow_id = entry.workflow_id.clone();
        drop(running);

        let pool = self.get_pool().await?;
        let now = chrono::Utc::now().to_rfc3339();
        Self::append_execution_log(
            &pool,
            ExecutionLogInsert {
                execution_id,
                node_id: None,
                level: "WARN",
                message: "Cancellation requested",
                metadata: Some(json!({ "workflow_id": workflow_id })),
                timestamp: &now,
            },
        )
        .await?;

        Ok(())
    }

    pub async fn is_workflow_running(&self, workflow_id: &str) -> bool {
        self.running_executions
            .read()
            .await
            .values()
            .any(|execution| execution.workflow_id == workflow_id)
    }

    pub async fn start_scheduler_runtime(self: &Arc<Self>) -> Result<()> {
        if self
            .scheduler_started
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }

        let pool = self.get_pool().await?;
        for workflow in self.list_workflows().await? {
            if let Err(error) = self
                .scheduler
                .sync_workflow_schedule(&pool, &workflow)
                .await
            {
                log::warn!(
                    "[Workflow:{}] Failed to sync schedule during startup: {}",
                    workflow.id,
                    error
                );
            }
        }

        let engine = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                if let Err(error) = engine.poll_due_cron_schedules().await {
                    log::error!("Scheduler poll failed: {}", error);
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            }
        });

        Ok(())
    }

    async fn poll_due_cron_schedules(&self) -> Result<()> {
        let pool = self.get_pool().await?;
        let due = self
            .scheduler
            .due_cron_workflows(&pool, chrono::Utc::now())
            .await?;

        for schedule in due {
            if self.is_workflow_running(&schedule.workflow_id).await {
                continue;
            }
            let expression = schedule
                .cron_expression
                .clone()
                .ok_or_else(|| AppError::Validation("Missing cron expression".to_string()))?;
            self.scheduler
                .mark_cron_executed(
                    &pool,
                    &schedule.workflow_id,
                    &expression,
                    chrono::Utc::now(),
                )
                .await?;

            if let Err(error) = self.start_workflow_execution_for_scheduler(&schedule).await {
                log::error!(
                    "[Workflow:{}] Failed to trigger scheduled execution: {}",
                    schedule.workflow_id,
                    error
                );
            }
        }

        Ok(())
    }

    async fn start_workflow_execution_for_scheduler(
        &self,
        schedule: &ScheduledWorkflow,
    ) -> Result<()> {
        let Some(workflow) = self.get_workflow(&schedule.workflow_id).await? else {
            return Ok(());
        };
        let Some(services) = self.services.read().await.clone() else {
            return Err(AppError::Unknown(
                "Engine not initialized with services".to_string(),
            ));
        };

        let execution_id = uuid::Uuid::new_v4().to_string();
        let trigger_label = "cron";
        self.record_execution_start(&execution_id, &workflow.id, trigger_label)
            .await?;

        let cancellation_flag = Arc::new(AtomicBool::new(false));
        self.running_executions.write().await.insert(
            execution_id.clone(),
            RunningExecution {
                workflow_id: workflow.id.clone(),
                cancellation_flag: Arc::clone(&cancellation_flag),
            },
        );

        let registry = Arc::clone(&self.registry);
        let retry_policy = self.retry_policy.clone();
        let db_pool = self.db_pool_handle();
        let running = Arc::clone(&self.running_executions);
        tokio::spawn(async move {
            let result = executor::execute_workflow_cancellable(
                &execution_id,
                &workflow,
                registry.as_ref(),
                &services,
                &retry_policy,
                cancellation_flag,
            )
            .await;

            if let Err(error) =
                WorkflowEngine::record_execution_complete_with_pool(&db_pool, &result).await
            {
                log::error!(
                    "[Workflow:{}] [Execution:{}] Failed to persist completion: {}",
                    result.workflow_id,
                    result.execution_id,
                    error
                );
            }

            running.write().await.remove(&execution_id);
        });

        Ok(())
    }

    /// Record the start of a workflow execution in the database.
    async fn record_execution_start(
        &self,
        execution_id: &str,
        workflow_id: &str,
        trigger_type: &str,
    ) -> Result<String> {
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

        Self::append_execution_log(
            &pool,
            ExecutionLogInsert {
                execution_id,
                node_id: None,
                level: "INFO",
                message: &format!("Workflow execution started (trigger: {})", trigger_type),
                metadata: Some(json!({ "workflow_id": workflow_id, "trigger_type": trigger_type })),
                timestamp: &now,
            },
        )
        .await?;

        Ok(now)
    }

    /// Record the completion of a workflow execution.
    async fn record_execution_complete(&self, result: &WorkflowExecutionResult) -> Result<()> {
        Self::record_execution_complete_with_pool(&self.db_pool, result).await
    }

    async fn record_execution_complete_with_pool(
        db_pool: &Arc<RwLock<Option<SqlitePool>>>,
        result: &WorkflowExecutionResult,
    ) -> Result<()> {
        let pool = db_pool
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Database {
                code: crate::errors::types::ErrorCode::DatabaseNotInitialized.as_str(),
                message: "Database not initialized".to_string(),
            })?;
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

        let completion_level = if result.status == WorkflowState::Failed.as_str() {
            "ERROR"
        } else {
            "INFO"
        };
        let completion_message = match &result.error {
            Some(error) => format!("Workflow execution {}: {}", result.status, error),
            None => format!("Workflow execution {}", result.status),
        };
        Self::append_execution_log(
            &pool,
            ExecutionLogInsert {
                execution_id: &result.execution_id,
                node_id: None,
                level: completion_level,
                message: &completion_message,
                metadata: Some(json!({
                    "workflow_id": result.workflow_id,
                    "status": result.status,
                    "node_count": result.node_results.len(),
                })),
                timestamp: &result.completed_at,
            },
        )
        .await?;

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

            let level = match node_result.status.as_str() {
                "FAILED" => "ERROR",
                "SKIPPED" => "WARN",
                _ => "INFO",
            };
            let message = match &node_result.error {
                Some(error) => format!(
                    "Node {} {} (retries: {}): {}",
                    node_result.node_id, node_result.status, node_result.retry_count, error
                ),
                None => format!(
                    "Node {} {} (retries: {})",
                    node_result.node_id, node_result.status, node_result.retry_count
                ),
            };
            Self::append_execution_log(
                &pool,
                ExecutionLogInsert {
                    execution_id: &result.execution_id,
                    node_id: Some(&node_result.node_id),
                    level,
                    message: &message,
                    metadata: node_result.output.clone(),
                    timestamp: &node_result.completed_at,
                },
            )
            .await?;
        }

        Ok(())
    }

    async fn append_execution_log(pool: &SqlitePool, entry: ExecutionLogInsert<'_>) -> Result<()> {
        let metadata_json = entry
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        sqlx::query(
            "INSERT INTO execution_logs (execution_id, node_id, level, message, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(entry.execution_id)
        .bind(entry.node_id)
        .bind(entry.level)
        .bind(entry.message)
        .bind(&metadata_json)
        .bind(entry.timestamp)
        .execute(pool)
        .await?;

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
    status: Option<String>,
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
            status: self.status.unwrap_or_else(|| "draft".to_string()),
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
