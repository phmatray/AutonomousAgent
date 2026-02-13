use crate::errors::Result;
use crate::models::workflow::{Workflow, WorkflowExecution};
use crate::services::AppState;
use crate::services::workflow_engine::executor::WorkflowExecutionResult;
use serde::{Deserialize, Serialize};
use tauri::State;

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
    workflow: Workflow,
    state: State<'_, AppState>,
) -> Result<Workflow> {
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
    state
        .engine
        .list_executions(workflow_id.as_deref())
        .await
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
