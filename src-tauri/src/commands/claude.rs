use crate::errors::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub id: String,
    pub status: String,
}

#[tauri::command]
pub async fn execute_plan(prompt: String) -> Result<ExecutionResult> {
    // TODO: Implement
    Ok(ExecutionResult {
        id: uuid::Uuid::new_v4().to_string(),
        status: "RUNNING".to_string(),
    })
}
