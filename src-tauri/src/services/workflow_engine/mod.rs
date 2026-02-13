pub mod executor;
pub mod node_registry;
pub mod nodes;
pub mod preflight;
pub mod scheduler;
pub mod state_machine;

use crate::errors::{AppError, Result};
use crate::models::workflow::{Workflow, WorkflowExecution, WorkflowSchedule};
use executor::{ExecutionRuntimeOptions, RetryPolicy, RuntimeNodeEvent, WorkflowExecutionResult};
use node_registry::{build_default_registry, ClaudeProvider, NodeRegistry, ServiceProvider};
use preflight::WorkflowPreflightResult;
use scheduler::{ScheduledWorkflow, Scheduler};
use serde::Serialize;
use serde_json::json;
use state_machine::WorkflowState;
use tauri::{AppHandle, Emitter};

use sqlx::sqlite::SqlitePool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionLogEvent {
    id: i64,
    execution_id: String,
    node_id: Option<String>,
    level: String,
    message: String,
    metadata: Option<serde_json::Value>,
    timestamp: String,
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
    app_handle: Arc<RwLock<Option<AppHandle>>>,
    stream_log_sequence: Arc<AtomicI64>,
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
            app_handle: Arc::new(RwLock::new(None)),
            stream_log_sequence: Arc::new(AtomicI64::new(1)),
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

    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        *self.app_handle.write().await = Some(app_handle);
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
            "SELECT
                w.id,
                w.name,
                w.description,
                w.status,
                w.nodes,
                w.edges,
                w.config,
                w.version,
                w.created_at,
                w.updated_at,
                ws.trigger_type AS schedule_trigger_type,
                ws.cron_expression AS schedule_cron_expression,
                ws.timezone AS schedule_timezone,
                ws.enabled AS schedule_enabled,
                ws.last_run_at AS schedule_last_run_at,
                ws.next_run_at AS schedule_next_run_at
             FROM workflows w
             LEFT JOIN workflow_schedules ws ON ws.workflow_id = w.id
             ORDER BY w.updated_at DESC",
        )
        .fetch_all(&pool)
        .await?;

        rows.into_iter().map(|r| r.into_workflow()).collect()
    }

    pub async fn get_workflow(&self, id: &str) -> Result<Option<Workflow>> {
        let pool = self.get_pool().await?;
        let row = sqlx::query_as::<_, WorkflowRow>(
            "SELECT
                w.id,
                w.name,
                w.description,
                w.status,
                w.nodes,
                w.edges,
                w.config,
                w.version,
                w.created_at,
                w.updated_at,
                ws.trigger_type AS schedule_trigger_type,
                ws.cron_expression AS schedule_cron_expression,
                ws.timezone AS schedule_timezone,
                ws.enabled AS schedule_enabled,
                ws.last_run_at AS schedule_last_run_at,
                ws.next_run_at AS schedule_next_run_at
             FROM workflows w
             LEFT JOIN workflow_schedules ws ON ws.workflow_id = w.id
             WHERE w.id = ?",
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

    fn next_stream_log_id(&self) -> i64 {
        -self.stream_log_sequence.fetch_add(1, Ordering::SeqCst)
    }

    async fn emit_app_event<T>(&self, event_name: &str, payload: T)
    where
        T: Serialize + Clone,
    {
        let app_handle = self.app_handle.read().await.clone();
        if let Some(app) = app_handle {
            let _ = app.emit(event_name, payload);
        }
    }

    async fn emit_execution_status(&self, execution: &WorkflowExecution) {
        self.emit_app_event("workflow:execution-status", execution.clone())
            .await;
    }

    async fn emit_execution_log_event(&self, payload: ExecutionLogEvent) {
        let event_name = format!("execution-log-{}", payload.execution_id);
        self.emit_app_event(&event_name, payload).await;
    }

    async fn handle_runtime_node_event(&self, event: RuntimeNodeEvent) -> Result<()> {
        let pool = self.get_pool().await?;
        let current_node_id = if event.status == "RUNNING" {
            Some(event.node_id.clone())
        } else {
            None
        };

        sqlx::query("UPDATE executions SET current_node_id = ? WHERE id = ?")
            .bind(current_node_id.as_deref())
            .bind(&event.execution_id)
            .execute(&pool)
            .await?;

        let status_event = WorkflowExecution {
            id: event.execution_id.clone(),
            workflow_id: event.workflow_id.clone(),
            status: WorkflowState::Running.as_str().to_string(),
            trigger_type: None,
            started_at: None,
            completed_at: None,
            error: None,
            context: None,
            current_node_id: current_node_id.clone(),
        };
        self.emit_execution_status(&status_event).await;

        let event_name = if event.status == "RUNNING" {
            "workflow:node-started"
        } else {
            "workflow:node-finished"
        };
        self.emit_app_event(event_name, event.clone()).await;

        let message = if event.status == "RUNNING" {
            format!("Node {} RUNNING", event.node_id)
        } else if let Some(error) = event.error.as_deref() {
            format!("Node {} {}: {}", event.node_id, event.status, error)
        } else {
            format!("Node {} {}", event.node_id, event.status)
        };
        self.emit_execution_log_event(ExecutionLogEvent {
            id: self.next_stream_log_id(),
            execution_id: event.execution_id,
            node_id: Some(event.node_id),
            level: if event.status == "FAILED" {
                "ERROR".to_string()
            } else {
                "INFO".to_string()
            },
            message,
            metadata: Some(json!({
                "node_type": event.node_type,
                "duration_ms": event.duration_ms,
                "retry_count": event.retry_count,
            })),
            timestamp: event.completed_at.unwrap_or(event.started_at),
        })
        .await;

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
        trigger_payload: Option<serde_json::Value>,
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
        let trigger = trigger_type.unwrap_or("manual");
        let run_context = Some(json!({
            "trigger": {
                "type": trigger,
                "payload": trigger_payload.unwrap_or(serde_json::Value::Null),
            }
        }));
        let result = executor::execute_workflow(
            &execution_id,
            &workflow,
            self.registry.as_ref(),
            services,
            &self.retry_policy,
            ExecutionRuntimeOptions {
                run_context,
                runtime_event_sender: None,
            },
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
        trigger_payload: Option<serde_json::Value>,
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
        let run_context = Some(json!({
            "trigger": {
                "type": trigger,
                "payload": trigger_payload.unwrap_or(serde_json::Value::Null),
            }
        }));
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
            let (runtime_event_tx, mut runtime_event_rx) = tokio::sync::mpsc::unbounded_channel();
            let runtime_engine = Arc::clone(&engine);
            let runtime_task = tokio::spawn(async move {
                while let Some(runtime_event) = runtime_event_rx.recv().await {
                    if let Err(error) = runtime_engine
                        .handle_runtime_node_event(runtime_event)
                        .await
                    {
                        log::error!("Failed to emit runtime node event: {}", error);
                    }
                }
            });

            let result = executor::execute_workflow_cancellable(
                &execution_id_for_task,
                &workflow,
                engine.registry.as_ref(),
                &services,
                &engine.retry_policy,
                ExecutionRuntimeOptions {
                    run_context,
                    runtime_event_sender: Some(runtime_event_tx),
                },
                cancellation_flag,
            )
            .await;
            let _ = runtime_task.await;

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
        self.append_execution_log(
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

    async fn poll_due_cron_schedules(self: &Arc<Self>) -> Result<()> {
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
        self: &Arc<Self>,
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

        let engine = Arc::clone(self);
        tokio::spawn(async move {
            let (runtime_event_tx, mut runtime_event_rx) = tokio::sync::mpsc::unbounded_channel();
            let runtime_engine = Arc::clone(&engine);
            let runtime_task = tokio::spawn(async move {
                while let Some(runtime_event) = runtime_event_rx.recv().await {
                    if let Err(error) = runtime_engine
                        .handle_runtime_node_event(runtime_event)
                        .await
                    {
                        log::error!("Failed to emit runtime node event: {}", error);
                    }
                }
            });

            let result = executor::execute_workflow_cancellable(
                &execution_id,
                &workflow,
                engine.registry.as_ref(),
                &services,
                &engine.retry_policy,
                ExecutionRuntimeOptions {
                    run_context: None,
                    runtime_event_sender: Some(runtime_event_tx),
                },
                cancellation_flag,
            )
            .await;
            let _ = runtime_task.await;

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
                .remove(&execution_id);
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

        self.append_execution_log(
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

        self.emit_execution_status(&WorkflowExecution {
            id: execution_id.to_string(),
            workflow_id: workflow_id.to_string(),
            status: WorkflowState::Running.as_str().to_string(),
            trigger_type: Some(trigger_type.to_string()),
            started_at: Some(now.clone()),
            completed_at: None,
            error: None,
            context: None,
            current_node_id: None,
        })
        .await;

        Ok(now)
    }

    /// Record the completion of a workflow execution.
    async fn record_execution_complete(&self, result: &WorkflowExecutionResult) -> Result<()> {
        let pool = self.get_pool().await?;
        let context_json = serde_json::to_string(&result.node_results)?;

        sqlx::query(
            "UPDATE executions SET status = ?, completed_at = ?, error = ?, context = ?, current_node_id = NULL WHERE id = ?",
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
        self.append_execution_log(
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
            self.append_execution_log(
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

        self.emit_execution_status(&WorkflowExecution {
            id: result.execution_id.clone(),
            workflow_id: result.workflow_id.clone(),
            status: result.status.clone(),
            trigger_type: None,
            started_at: Some(result.started_at.clone()),
            completed_at: Some(result.completed_at.clone()),
            error: result.error.clone(),
            context: Some(serde_json::to_value(&result.node_results)?),
            current_node_id: None,
        })
        .await;

        Ok(())
    }

    async fn append_execution_log(
        &self,
        pool: &SqlitePool,
        entry: ExecutionLogInsert<'_>,
    ) -> Result<()> {
        let metadata_json = entry
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let result = sqlx::query(
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

        self.emit_execution_log_event(ExecutionLogEvent {
            id: result.last_insert_rowid(),
            execution_id: entry.execution_id.to_string(),
            node_id: entry.node_id.map(ToString::to_string),
            level: entry.level.to_string(),
            message: entry.message.to_string(),
            metadata: entry.metadata,
            timestamp: entry.timestamp.to_string(),
        })
        .await;

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
    schedule_trigger_type: Option<String>,
    schedule_cron_expression: Option<String>,
    schedule_timezone: Option<String>,
    schedule_enabled: Option<i64>,
    schedule_last_run_at: Option<String>,
    schedule_next_run_at: Option<String>,
}

impl WorkflowRow {
    fn into_workflow(self) -> Result<Workflow> {
        let nodes = serde_json::from_str(&self.nodes)?;
        let edges = serde_json::from_str(&self.edges)?;
        let config = self.config.map(|c| serde_json::from_str(&c)).transpose()?;
        let schedule = self
            .schedule_trigger_type
            .map(|trigger_type| WorkflowSchedule {
                trigger_type,
                cron_expression: self.schedule_cron_expression,
                timezone: self.schedule_timezone,
                enabled: self
                    .schedule_enabled
                    .map(|value| value != 0)
                    .unwrap_or(true),
                last_run_at: self.schedule_last_run_at,
                next_run_at: self.schedule_next_run_at,
            });

        Ok(Workflow {
            id: self.id,
            name: self.name,
            description: self.description,
            status: self.status.unwrap_or_else(|| "draft".to_string()),
            nodes,
            edges,
            config,
            schedule,
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
