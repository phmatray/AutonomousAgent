use crate::errors::Result;
use crate::services::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub id: String,
    pub status: String,
    pub started_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeCredentialStatusResponse {
    pub configured: bool,
    pub account_label: Option<String>,
}

#[tauri::command]
pub async fn execute_plan(
    prompt: String,
    working_dir: Option<String>,
    timeout_secs: Option<u64>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ExecutionResult> {
    let execution_id = uuid::Uuid::new_v4().to_string();

    let info = state
        .claude
        .execute(app, execution_id, prompt, working_dir, timeout_secs)
        .await?;

    Ok(ExecutionResult {
        id: info.id,
        status: info.status,
        started_at: Some(info.started_at),
    })
}

#[tauri::command]
pub async fn cancel_execution(execution_id: String, state: State<'_, AppState>) -> Result<()> {
    state.claude.cancel(&execution_id).await
}

#[tauri::command]
pub async fn list_running_executions(state: State<'_, AppState>) -> Result<Vec<String>> {
    Ok(state.claude.list_running().await)
}

#[tauri::command]
pub async fn get_claude_credential_status(
    state: State<'_, AppState>,
) -> Result<ClaudeCredentialStatusResponse> {
    let status = state.storage.get_claude_credential_status().await?;
    Ok(ClaudeCredentialStatusResponse {
        configured: status.configured,
        account_label: status.account_label,
    })
}

#[tauri::command]
pub async fn save_claude_credential(
    api_key: String,
    account_label: Option<String>,
    state: State<'_, AppState>,
) -> Result<ClaudeCredentialStatusResponse> {
    let status = state
        .storage
        .save_claude_credential(account_label.as_deref(), &api_key)
        .await?;

    std::env::set_var("ANTHROPIC_API_KEY", api_key.trim());

    Ok(ClaudeCredentialStatusResponse {
        configured: status.configured,
        account_label: status.account_label,
    })
}
