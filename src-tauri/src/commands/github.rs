use crate::errors::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResult {
    pub success: bool,
    pub username: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Repository {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub owner: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Issue {
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
}

#[tauri::command]
pub async fn authenticate_github(token: String) -> Result<AuthResult> {
    // TODO: Implement
    Ok(AuthResult {
        success: true,
        username: Some("test_user".to_string()),
    })
}

#[tauri::command]
pub async fn list_repositories() -> Result<Vec<Repository>> {
    // TODO: Implement
    Ok(vec![])
}

#[tauri::command]
pub async fn list_issues(owner: String, repo: String) -> Result<Vec<Issue>> {
    // TODO: Implement
    Ok(vec![])
}
