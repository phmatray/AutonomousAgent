use crate::errors::Result;
use crate::services::{AppState, InitializationState};
use tauri::State;

#[tauri::command]
pub async fn is_initialized(state: State<'_, AppState>) -> Result<InitializationState> {
    let init_state = state.initialization.read().await;
    Ok(init_state.clone())
}
