use crate::errors::{AppError, Result};
use crate::services::workflow_engine::node_registry::{
    ExecutionContext, NodeExecutor, ServiceProvider,
};
use async_trait::async_trait;
use serde_json::Value;

fn get_required_string(config: &Value, key: &str) -> Result<String> {
    config[key]
        .as_str()
        .ok_or_else(|| AppError::Validation(format!("{} is required and must be a string", key)))
        .map(String::from)
}

fn get_optional_string<'a>(config: &'a Value, key: &str) -> Option<&'a str> {
    config
        .get(key)
        .and_then(|value| value.as_str())
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
}

const ACTIVE_SESSION_CREDENTIAL_ID: &str = "__active_session__";

async fn authenticate_for_config(
    config: &Value,
    services: &ServiceProvider,
    require_auth: bool,
) -> Result<Option<String>> {
    let credential_id = get_optional_string(config, "credential_id");
    if credential_id == Some(ACTIVE_SESSION_CREDENTIAL_ID) {
        if services.github.get_authenticated_user().await.is_ok() {
            return Ok(None);
        }
        return Err(AppError::Authentication(
            "Selected session credential is unavailable; reconnect in Settings".to_string(),
        ));
    }

    match services
        .storage
        .get_github_token_for_credential_or_default(credential_id)
    {
        Ok(token) => {
            services.github.authenticate(&token).await?;
            Ok(Some(token))
        }
        Err(err) => {
            if services.github.get_authenticated_user().await.is_ok() {
                Ok(None)
            } else if require_auth || credential_id.is_some() {
                Err(err)
            } else {
                // Allow unauthenticated github.sync for public repositories.
                Ok(None)
            }
        }
    }
}

/// Clone or pull a GitHub repository to ensure it is up to date.
///
/// Config:
///   - `owner`: repository owner
///   - `repo`: repository name
///   - `path`: local filesystem path for the clone
///
/// Output:
///   - `repo_path`: path to the local repository
///   - `owner`: repository owner
///   - `repo`: repository name
pub struct GithubSyncNode;

#[async_trait]
impl NodeExecutor for GithubSyncNode {
    fn node_type(&self) -> &'static str {
        "github.sync"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["owner", "repo", "path"] {
            if config.get(field).and_then(|v| v.as_str()).is_none() {
                return Err(AppError::Validation(format!(
                    "github.sync requires '{}' in config",
                    field
                )));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let owner = get_required_string(config, "owner")?;
        let repo = get_required_string(config, "repo")?;
        let path = get_required_string(config, "path")?;
        let token = authenticate_for_config(config, services, false).await?;

        let repo_path = format!("{}/{}", path, repo);

        // Check if the repo already exists locally
        if std::path::Path::new(&repo_path).join(".git").exists() {
            services.git.pull(&repo_path).await?;
        } else {
            let url = if let Some(token) = token {
                format!(
                    "https://x-access-token:{}@github.com/{}/{}.git",
                    token, owner, repo
                )
            } else {
                format!("https://github.com/{}/{}.git", owner, repo)
            };
            services.git.clone_repo(&url, &repo_path).await?;
        }

        // Set the working directory for subsequent nodes
        context.set_working_dir(Some(repo_path.clone()));

        Ok(serde_json::json!({
            "repo_path": repo_path,
            "owner": owner,
            "repo": repo,
        }))
    }
}

/// Fetch open issues from a GitHub repository.
///
/// Config:
///   - `owner`: repository owner (or `{{node_id.owner}}`)
///   - `repo`: repository name (or `{{node_id.repo}}`)
///
/// Output:
///   - `issues`: array of issue objects
///   - `count`: number of issues
pub struct GithubReadIssuesNode;

#[async_trait]
impl NodeExecutor for GithubReadIssuesNode {
    fn node_type(&self) -> &'static str {
        "github.readIssues"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["owner", "repo"] {
            if config.get(field).and_then(|v| v.as_str()).is_none() {
                return Err(AppError::Validation(format!(
                    "github.readIssues requires '{}' in config",
                    field
                )));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        authenticate_for_config(&resolved, services, true).await?;
        let owner = resolved["owner"]
            .as_str()
            .ok_or_else(|| AppError::Validation("owner must be a string".into()))?;
        let repo = resolved["repo"]
            .as_str()
            .ok_or_else(|| AppError::Validation("repo must be a string".into()))?;

        let issues = services.github.list_issues(owner, repo).await?;

        let issues_json: Vec<Value> = issues
            .iter()
            .map(|i| {
                serde_json::json!({
                    "number": i.number,
                    "title": i.title,
                    "body": i.body,
                    "state": i.state,
                    "labels": i.labels,
                    "assignees": i.assignees,
                })
            })
            .collect();

        let count = issues_json.len();

        Ok(serde_json::json!({
            "issues": issues_json,
            "count": count,
        }))
    }
}

/// Fetch open issues from a GitHub repository and sync them into backlog storage.
///
/// Config:
///   - `owner`: repository owner (or `{{node_id.owner}}`)
///   - `repo`: repository name (or `{{node_id.repo}}`)
///
/// Output:
///   - `owner`: repository owner
///   - `repo`: repository name
///   - `count`: number of backlog items synced for this repository
///   - `items`: synced backlog items
pub struct BacklogSyncIssuesNode;

#[async_trait]
impl NodeExecutor for BacklogSyncIssuesNode {
    fn node_type(&self) -> &'static str {
        "backlog.syncIssues"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["owner", "repo"] {
            if config.get(field).and_then(|v| v.as_str()).is_none() {
                return Err(AppError::Validation(format!(
                    "backlog.syncIssues requires '{}' in config",
                    field
                )));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        authenticate_for_config(&resolved, services, true).await?;

        let owner = resolved["owner"]
            .as_str()
            .ok_or_else(|| AppError::Validation("owner must be a string".into()))?;
        let repo = resolved["repo"]
            .as_str()
            .ok_or_else(|| AppError::Validation("repo must be a string".into()))?;

        let issues = services.github.list_issues(owner, repo).await?;
        let synced_items = services
            .backlog
            .sync_issues_to_backlog(owner, repo, issues)
            .await?;
        let count = synced_items.len();

        Ok(serde_json::json!({
            "owner": owner,
            "repo": repo,
            "count": count,
            "items": synced_items,
        }))
    }
}

/// Create a pull request on GitHub.
///
/// Config:
///   - `owner`: repository owner
///   - `repo`: repository name
///   - `title`: PR title
///   - `body`: PR body/description
///   - `head`: source branch
///   - `base`: target branch (defaults to "develop")
///
/// Output:
///   - `number`: PR number
///   - `html_url`: URL to the PR
///   - `title`: PR title
pub struct GithubCreatePrNode;

#[async_trait]
impl NodeExecutor for GithubCreatePrNode {
    fn node_type(&self) -> &'static str {
        "github.createPR"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["owner", "repo", "title", "head"] {
            if config.get(field).and_then(|v| v.as_str()).is_none() {
                return Err(AppError::Validation(format!(
                    "github.createPR requires '{}' in config",
                    field
                )));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config)?;
        authenticate_for_config(&resolved, services, true).await?;
        let owner = get_required_string(&resolved, "owner")?;
        let repo = get_required_string(&resolved, "repo")?;
        let title = get_required_string(&resolved, "title")?;
        let body = resolved["body"].as_str().unwrap_or("");
        let head = get_required_string(&resolved, "head")?;
        let base = resolved["base"].as_str().unwrap_or("develop");

        let pr = services
            .github
            .create_pull_request(&owner, &repo, &title, body, &head, base)
            .await?;

        Ok(serde_json::json!({
            "number": pr.number,
            "html_url": pr.html_url,
            "title": pr.title,
        }))
    }
}
