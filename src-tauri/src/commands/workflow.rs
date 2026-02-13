use crate::errors::Result;
use crate::models::workflow::{Workflow, WorkflowExecution};
use crate::services::workflow_engine::executor::WorkflowExecutionResult;
use crate::services::AppState;
use chrono;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid;

#[tauri::command]
pub async fn list_workflows(state: State<'_, AppState>) -> Result<Vec<Workflow>> {
    state.engine.list_workflows().await
}

#[tauri::command]
pub async fn get_workflow(id: String, state: State<'_, AppState>) -> Result<Option<Workflow>> {
    state.engine.get_workflow(&id).await
}

#[tauri::command]
pub async fn create_workflow(
    mut workflow: Workflow,
    state: State<'_, AppState>,
) -> Result<Workflow> {
    // Generate missing fields if not provided
    if workflow.id.is_empty() {
        workflow.id = uuid::Uuid::new_v4().to_string();
    }
    if workflow.created_at.is_empty() {
        workflow.created_at = chrono::Utc::now().to_rfc3339();
    }
    if workflow.updated_at.is_empty() {
        workflow.updated_at = chrono::Utc::now().to_rfc3339();
    }

    state.engine.create_workflow(&workflow).await
}

#[tauri::command]
pub async fn update_workflow(
    id: String,
    workflow: Workflow,
    state: State<'_, AppState>,
) -> Result<Workflow> {
    state.engine.update_workflow(&id, &workflow).await
}

#[tauri::command]
pub async fn delete_workflow(id: String, state: State<'_, AppState>) -> Result<()> {
    state.engine.delete_workflow(&id).await
}

#[tauri::command]
pub async fn execute_workflow(
    workflow_id: String,
    trigger_type: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkflowExecutionResult> {
    state
        .engine
        .execute_workflow(&workflow_id, trigger_type.as_deref())
        .await
}

#[tauri::command]
pub async fn list_executions(
    workflow_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<WorkflowExecution>> {
    state.engine.list_executions(workflow_id.as_deref()).await
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionLogEntry {
    pub id: i64,
    pub execution_id: String,
    pub node_id: Option<String>,
    pub level: String,
    pub message: String,
    pub metadata: Option<serde_json::Value>,
    pub timestamp: String,
}

#[tauri::command]
pub async fn get_execution_logs(
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ExecutionLogEntry>> {
    state.engine.get_execution_logs(&execution_id).await
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugBundle {
    pub exported_at: String,
    pub app_version: String,
    pub platform: String,
    pub execution: WorkflowExecution,
    pub workflow: Option<Workflow>,
    pub logs: Vec<ExecutionLogEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyDebugBundleResponse {
    pub bundle_json: String,
}

#[tauri::command]
pub async fn copy_debug_bundle(
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<CopyDebugBundleResponse> {
    let execution = state
        .engine
        .list_executions(None)
        .await?
        .into_iter()
        .find(|exec| exec.id == execution_id)
        .ok_or_else(|| {
            crate::errors::AppError::Validation(format!("Execution {} not found", execution_id))
        })?;

    let workflow = state.engine.get_workflow(&execution.workflow_id).await?;
    let logs = state.engine.get_execution_logs(&execution.id).await?;

    let bundle = DebugBundle {
        exported_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        execution,
        workflow,
        logs,
    };

    Ok(CopyDebugBundleResponse {
        bundle_json: serde_json::to_string_pretty(&bundle)?,
    })
}
