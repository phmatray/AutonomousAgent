use crate::errors::Result;
use crate::services::git_service::GitService;
use crate::services::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct CommitParams {
    pub commit_type: String,
    pub scope: Option<String>,
    pub description: String,
    pub gitmoji: Option<String>,
}

#[tauri::command]
pub async fn git_status(
    repo_path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let status = state.git.status(&repo_path)?;
    Ok(serde_json::to_value(status).unwrap())
}

#[tauri::command]
pub async fn git_log(
    repo_path: String,
    max_count: Option<usize>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let entries = state.git.log(&repo_path, max_count.unwrap_or(20))?;
    Ok(serde_json::to_value(entries).unwrap())
}

#[tauri::command]
pub async fn git_diff(repo_path: String, state: State<'_, AppState>) -> Result<String> {
    state.git.diff_summary(&repo_path)
}

#[tauri::command]
pub async fn git_create_worktree(
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state
        .git
        .create_worktree(&repo_path, &worktree_path, &branch_name)
        .await
}

#[tauri::command]
pub async fn git_list_worktrees(
    repo_path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let worktrees = state.git.list_worktrees(&repo_path).await?;
    Ok(serde_json::to_value(worktrees).unwrap())
}

#[tauri::command]
pub async fn git_remove_worktree(
    repo_path: String,
    worktree_path: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state.git.remove_worktree(&repo_path, &worktree_path).await
}

#[tauri::command]
pub async fn git_commit(
    repo_path: String,
    params: CommitParams,
    state: State<'_, AppState>,
) -> Result<String> {
    // Stage all changes
    state.git.add_all(&repo_path).await?;

    // Build conventional commit message with gitmoji
    let message = GitService::conventional_commit(
        &params.commit_type,
        params.scope.as_deref(),
        &params.description,
        params.gitmoji.as_deref(),
    );

    // Commit
    state.git.commit(&repo_path, &message).await
}

#[tauri::command]
pub async fn git_push(
    repo_path: String,
    branch_name: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state.git.push(&repo_path, &branch_name).await
}

#[tauri::command]
pub async fn git_pull(repo_path: String, state: State<'_, AppState>) -> Result<()> {
    state.git.pull(&repo_path).await
}

#[tauri::command]
pub async fn git_clone(url: String, target_path: String, state: State<'_, AppState>) -> Result<()> {
    state.git.clone_repo(&url, &target_path).await
}
