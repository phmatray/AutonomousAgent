use crate::errors::Result;
use crate::models::backlog::{BacklogFilters, BacklogItem};
use crate::services::AppState;
use tauri::State;

#[tauri::command]
pub async fn list_backlog_items(
    owner: Option<String>,
    repo: Option<String>,
    state_filter: Option<String>,
    label: Option<String>,
    search: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BacklogItem>> {
    let filters = BacklogFilters {
        owner,
        repo,
        state: state_filter,
        label,
        search,
    };
    state.backlog.list_backlog_items(&filters).await
}

#[tauri::command]
pub async fn sync_github_issues_to_backlog(
    owner: String,
    repo: String,
    state: State<'_, AppState>,
) -> Result<Vec<BacklogItem>> {
    crate::commands::github::ensure_github_authenticated(&state).await?;
    let issues = state.github.list_issues(&owner, &repo).await?;
    state
        .backlog
        .sync_issues_to_backlog(&owner, &repo, issues)
        .await
}

#[tauri::command]
pub async fn link_backlog_to_workflow(
    backlog_item_id: String,
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state
        .backlog
        .link_to_workflow(&backlog_item_id, &workflow_id)
        .await
}

#[tauri::command]
pub async fn delete_backlog_item(id: String, state: State<'_, AppState>) -> Result<()> {
    state.backlog.delete_backlog_item(&id).await
}
