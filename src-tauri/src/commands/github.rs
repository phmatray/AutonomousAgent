use crate::errors::Result;
use crate::services::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

pub const ACTIVE_SESSION_CREDENTIAL_ID: &str = "__active_session__";

pub(crate) async fn ensure_github_authenticated(state: &AppState) -> Result<()> {
    if state.github.get_authenticated_user().await.is_ok() {
        return Ok(());
    }

    let token = state.storage.get_github_token().await?;
    state.github.authenticate(&token).await?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitHubCredentialResponse {
    pub id: String,
    pub username: String,
    pub label: String,
    pub is_default: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialAuditEventResponse {
    pub id: String,
    pub provider: String,
    pub action: String,
    pub success: bool,
    pub detail: Option<String>,
    pub timestamp: String,
}

async fn append_audit_event(
    state: &AppState,
    provider: &str,
    action: &str,
    success: bool,
    detail: Option<String>,
) {
    if let Err(err) = state
        .storage
        .append_credential_audit_event(provider, action, success, detail.as_deref())
        .await
    {
        eprintln!("Failed to append credential audit event: {}", err);
    }
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
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(crate::errors::AppError::Validation(
            "GitHub token cannot be empty".to_string(),
        ));
    }

    match state.github.authenticate(&token).await {
        Ok(user) => {
            // Persist as reusable credential profile and keep legacy token for compatibility.
            state
                .storage
                .save_github_credential(&user.login, &token)
                .await?;
            let _ = state.storage.set_github_token(&token).await;
            append_audit_event(
                &state,
                "github",
                "save_token",
                true,
                Some("GitHub token authenticated and persisted.".to_string()),
            )
            .await;

            Ok(AuthResult {
                success: true,
                username: Some(user.login),
                avatar_url: Some(user.avatar_url),
            })
        }
        Err(e) => {
            append_audit_event(&state, "github", "save_token", false, Some(e.to_string())).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn list_github_credentials(
    state: State<'_, AppState>,
) -> Result<Vec<GitHubCredentialResponse>> {
    let mut credentials = match state.storage.list_github_credentials().await {
        Ok(credentials) => credentials,
        Err(err) => {
            eprintln!("Could not load stored credentials: {}", err);
            Vec::new()
        }
    };

    // Backfill credentials for users authenticated before multi-credential support.
    if credentials.is_empty() && ensure_github_authenticated(&state).await.is_ok() {
        if let Ok(user) = state.github.get_authenticated_user().await {
            if let Ok(token) = state.storage.get_github_token().await {
                let _ = state
                    .storage
                    .save_github_credential(&user.login, &token)
                    .await;
                credentials = state
                    .storage
                    .list_github_credentials()
                    .await
                    .unwrap_or_default();
            }
        }
    }

    let mut response: Vec<GitHubCredentialResponse> = credentials
        .into_iter()
        .map(|credential| GitHubCredentialResponse {
            id: credential.id,
            username: credential.username,
            label: credential.label,
            is_default: credential.is_default,
        })
        .collect();

    // If secure storage is unavailable, still expose the currently authenticated session
    // so users can select it in GitHub nodes.
    if response.is_empty() {
        if let Ok(user) = state.github.get_authenticated_user().await {
            response.push(GitHubCredentialResponse {
                id: ACTIVE_SESSION_CREDENTIAL_ID.to_string(),
                username: user.login.clone(),
                label: format!("{} (Current session)", user.login),
                is_default: true,
            });
        }
    }

    Ok(response)
}

#[tauri::command]
pub async fn list_repositories(state: State<'_, AppState>) -> Result<Vec<Repository>> {
    ensure_github_authenticated(&state).await?;
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
    ensure_github_authenticated(&state).await?;
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
    ensure_github_authenticated(&state).await?;
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
    if let Err(e) = ensure_github_authenticated(&state).await {
        eprintln!("GitHub session restore unavailable: {}", e);
    }

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

#[tauri::command]
pub async fn get_saved_github_token(state: State<'_, AppState>) -> Result<serde_json::Value> {
    let token = state.storage.get_github_token().await.ok();

    Ok(serde_json::json!({
        "token": token
    }))
}

#[tauri::command]
pub async fn delete_github_token(state: State<'_, AppState>) -> Result<()> {
    match state.storage.delete_all_github_credentials().await {
        Ok(_) => {
            state.github.clear_authentication().await;
            append_audit_event(
                &state,
                "github",
                "delete_token",
                true,
                Some("Removed all saved GitHub credential entries.".to_string()),
            )
            .await;
            Ok(())
        }
        Err(error) => {
            append_audit_event(
                &state,
                "github",
                "delete_token",
                false,
                Some(error.to_string()),
            )
            .await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn delete_github_credential(
    credential_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let credential_id = credential_id.trim().to_string();
    if credential_id.is_empty() {
        return Err(crate::errors::AppError::Validation(
            "credential_id cannot be empty".to_string(),
        ));
    }
    if credential_id == ACTIVE_SESSION_CREDENTIAL_ID {
        return Err(crate::errors::AppError::Validation(
            "Cannot delete active session credential placeholder".to_string(),
        ));
    }

    match state.storage.delete_github_credential(&credential_id).await {
        Ok(_) => {
            state.github.clear_authentication().await;
            append_audit_event(
                &state,
                "github",
                "delete_credential",
                true,
                Some(format!("Removed credential '{}'.", credential_id)),
            )
            .await;
            Ok(())
        }
        Err(error) => {
            append_audit_event(
                &state,
                "github",
                "delete_credential",
                false,
                Some(error.to_string()),
            )
            .await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn verify_github_token(
    token: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err(crate::errors::AppError::Validation(
            "GitHub token cannot be empty".to_string(),
        ));
    }

    match state.github.authenticate(&token).await {
        Ok(user) => {
            append_audit_event(
                &state,
                "github",
                "verify_reveal",
                true,
                Some("Verified token for reveal.".to_string()),
            )
            .await;
            Ok(serde_json::json!({
                "valid": true,
                "username": user.login
            }))
        }
        Err(error) => {
            append_audit_event(
                &state,
                "github",
                "verify_reveal",
                false,
                Some(error.to_string()),
            )
            .await;
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn list_credential_audit_events(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<CredentialAuditEventResponse>> {
    let events = state.storage.list_credential_audit_events(limit).await?;

    Ok(events
        .into_iter()
        .map(|event| CredentialAuditEventResponse {
            id: event.id,
            provider: event.provider,
            action: event.action,
            success: event.success,
            detail: event.detail,
            timestamp: event.timestamp,
        })
        .collect())
}
