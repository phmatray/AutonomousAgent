use crate::errors::Result;
use crate::services::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Repository {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub owner: String,
    pub description: Option<String>,
    pub default_branch: String,
    pub private: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Issue {
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
}

#[tauri::command]
pub async fn authenticate_github(token: String, state: State<'_, AppState>) -> Result<AuthResult> {
    // Store token securely
    state.storage.set_github_token(&token)?;

    // Authenticate with GitHub
    match state.github.authenticate(&token).await {
        Ok(user) => Ok(AuthResult {
            success: true,
            username: Some(user.login),
            avatar_url: Some(user.avatar_url),
        }),
        Err(e) => {
            // Remove token if auth failed
            let _ = state.storage.delete_github_token();
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn list_repositories(state: State<'_, AppState>) -> Result<Vec<Repository>> {
    let repos = state.github.list_repositories().await?;

    Ok(repos
        .into_iter()
        .map(|r| Repository {
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            owner: r.owner,
            description: r.description,
            default_branch: r.default_branch,
            private: r.private,
        })
        .collect())
}

#[tauri::command]
pub async fn list_issues(
    owner: String,
    repo: String,
    state: State<'_, AppState>,
) -> Result<Vec<Issue>> {
    let issues = state.github.list_issues(&owner, &repo).await?;

    Ok(issues
        .into_iter()
        .map(|i| Issue {
            number: i.number,
            title: i.title,
            body: i.body,
            state: i.state,
            labels: i.labels,
            assignees: i.assignees,
        })
        .collect())
}

#[tauri::command]
pub async fn create_pull_request(
    owner: String,
    repo: String,
    title: String,
    body: String,
    head: String,
    base: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let pr = state
        .github
        .create_pull_request(&owner, &repo, &title, &body, &head, &base)
        .await?;

    Ok(serde_json::json!({
        "number": pr.number,
        "html_url": pr.html_url,
        "title": pr.title,
    }))
}

#[tauri::command]
pub async fn get_auth_status(state: State<'_, AppState>) -> Result<serde_json::Value> {
    match state.github.get_authenticated_user().await {
        Ok(user) => Ok(serde_json::json!({
            "authenticated": true,
            "username": user.login,
        })),
        Err(_) => Ok(serde_json::json!({
            "authenticated": false,
        })),
    }
}
