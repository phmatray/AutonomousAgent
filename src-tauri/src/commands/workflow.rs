use crate::errors::Result;
use crate::models::workflow::{Workflow, WorkflowExecution};
use crate::services::storage::CredentialAuditEvent;
use crate::services::workflow_engine::preflight::WorkflowPreflightResult;
use crate::services::AppState;
use chrono::{DateTime, Utc};
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
    if workflow.status.trim().is_empty() {
        workflow.status = "draft".to_string();
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
    trigger_payload: Option<serde_json::Value>,
    state: State<'_, AppState>,
) -> Result<WorkflowExecution> {
    state
        .engine
        .start_workflow_execution(&workflow_id, trigger_type.as_deref(), trigger_payload)
        .await
}

#[tauri::command]
pub async fn cancel_workflow_execution(
    execution_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state.engine.cancel_workflow_execution(&execution_id).await
}

#[tauri::command]
pub async fn preflight_workflow(
    workflow: Workflow,
    state: State<'_, AppState>,
) -> Result<WorkflowPreflightResult> {
    state.engine.preflight_workflow(&workflow).await
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
    pub credential_audit_events: Vec<CredentialAuditEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CredentialAuditFilter {
    pub provider: Option<String>,
    pub action: Option<String>,
    pub result: Option<String>,
    pub from_timestamp: Option<String>,
    pub to_timestamp: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyDebugBundleResponse {
    pub bundle_json: String,
}

fn credential_event_matches_filter(
    event: &CredentialAuditEvent,
    filter: &CredentialAuditFilter,
) -> bool {
    if let Some(provider) = filter.provider.as_deref().map(str::trim) {
        if !provider.is_empty() && !event.provider.eq_ignore_ascii_case(provider) {
            return false;
        }
    }

    if let Some(action) = filter.action.as_deref().map(str::trim) {
        if !action.is_empty() && !event.action.eq_ignore_ascii_case(action) {
            return false;
        }
    }

    if let Some(result) = filter.result.as_deref().map(str::trim) {
        if result.eq_ignore_ascii_case("success") && !event.success {
            return false;
        }
        if result.eq_ignore_ascii_case("failure") && event.success {
            return false;
        }
    }

    let event_timestamp = DateTime::parse_from_rfc3339(&event.timestamp).ok();

    if let Some(from_timestamp) = filter.from_timestamp.as_deref().map(str::trim) {
        if !from_timestamp.is_empty() {
            if let (Some(event_ts), Ok(from_ts)) = (
                event_timestamp.as_ref(),
                DateTime::parse_from_rfc3339(from_timestamp),
            ) {
                if *event_ts < from_ts {
                    return false;
                }
            }
        }
    }

    if let Some(to_timestamp) = filter.to_timestamp.as_deref().map(str::trim) {
        if !to_timestamp.is_empty() {
            if let (Some(event_ts), Ok(to_ts)) = (
                event_timestamp.as_ref(),
                DateTime::parse_from_rfc3339(to_timestamp),
            ) {
                if *event_ts > to_ts {
                    return false;
                }
            }
        }
    }

    true
}

#[tauri::command]
pub async fn copy_debug_bundle(
    execution_id: String,
    credential_audit_filter: Option<CredentialAuditFilter>,
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

    let output_limit = credential_audit_filter
        .as_ref()
        .and_then(|filter| filter.limit)
        .unwrap_or(100)
        .clamp(1, 200);
    let fetch_limit = if credential_audit_filter.is_some() {
        200
    } else {
        output_limit
    };

    let mut credential_audit_events = match state
        .storage
        .list_credential_audit_events(Some(fetch_limit))
        .await
    {
        Ok(events) => events,
        Err(error) => {
            eprintln!(
                "Could not include credential audit events in debug bundle: {}",
                error
            );
            Vec::new()
        }
    };

    if let Some(filter) = credential_audit_filter.as_ref() {
        credential_audit_events.retain(|event| credential_event_matches_filter(event, filter));
    }
    credential_audit_events.truncate(output_limit);

    let bundle = DebugBundle {
        exported_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        execution,
        workflow,
        logs,
        credential_audit_events,
    };

    Ok(CopyDebugBundleResponse {
        bundle_json: serde_json::to_string_pretty(&bundle)?,
    })
}
