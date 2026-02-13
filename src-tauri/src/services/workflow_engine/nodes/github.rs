use crate::errors::{AppError, Result};
use crate::services::backlog_service::PullRequestBacklogInput;
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

fn get_required_i64(config: &Value, key: &str) -> Result<i64> {
    match config.get(key) {
        Some(Value::Number(number)) => number.as_i64().ok_or_else(|| {
            AppError::Validation(format!("{} is required and must be an integer", key))
        }),
        Some(Value::String(value)) => value.trim().parse::<i64>().map_err(|_| {
            AppError::Validation(format!("{} is required and must be an integer", key))
        }),
        _ => Err(AppError::Validation(format!(
            "{} is required and must be an integer",
            key
        ))),
    }
}

fn get_optional_string_list(config: &Value, key: &str) -> Vec<String> {
    match config.get(key) {
        Some(Value::Array(values)) => values
            .iter()
            .filter_map(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect(),
        Some(Value::String(value)) => value
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .collect(),
        _ => Vec::new(),
    }
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
            "Selected session credential is unavailable; reconnect in Credentials".to_string(),
        ));
    }

    match services
        .storage
        .get_github_token_for_credential_or_default(credential_id)
        .await
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

/// Read pull request details from GitHub.
///
/// Config:
///   - `owner`: repository owner
///   - `repo`: repository name
///   - `pr_number`: pull request number
///
/// Output:
///   - `number`: PR number
///   - `html_url`: PR URL
///   - `title`: PR title
///   - `body`: PR body
///   - `state`: PR state
///   - `draft`: whether PR is draft
///   - `author`: PR author login
///   - `head_branch`: source branch
///   - `base_branch`: target branch
pub struct GithubReadPullRequestNode;

#[async_trait]
impl NodeExecutor for GithubReadPullRequestNode {
    fn node_type(&self) -> &'static str {
        "github.readPullRequest"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["owner", "repo", "pr_number"] {
            if config.get(field).is_none() {
                return Err(AppError::Validation(format!(
                    "github.readPullRequest requires '{}' in config",
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
        let pr_number = get_required_i64(&resolved, "pr_number")?;

        let pr = services
            .github
            .get_pull_request(&owner, &repo, pr_number)
            .await?;

        Ok(serde_json::json!({
            "number": pr.number,
            "html_url": pr.html_url,
            "title": pr.title,
            "body": pr.body,
            "state": pr.state,
            "draft": pr.draft,
            "author": pr.author,
            "head_branch": pr.head_branch,
            "base_branch": pr.base_branch,
        }))
    }
}

/// Register or update a pull request as a backlog item.
///
/// Config:
///   - `owner`: repository owner
///   - `repo`: repository name
///   - `pr_number`: pull request number
///   - `title`: pull request title
///   - `body`: optional pull request body
///   - `state`: optional pull request state (defaults to "open")
///   - `html_url`: optional pull request URL
///   - `labels`: optional labels array or comma-separated string
///   - `assignees`: optional assignees array or comma-separated string
///
/// Output:
///   - `id`: backlog item id
///   - `owner`: repository owner
///   - `repo`: repository name
///   - `issue_number`: pull request number
///   - `title`: pull request title
///   - `html_url`: pull request URL
///   - `state`: pull request state
pub struct BacklogRegisterPullRequestNode;

#[async_trait]
impl NodeExecutor for BacklogRegisterPullRequestNode {
    fn node_type(&self) -> &'static str {
        "backlog.registerPullRequest"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["owner", "repo", "pr_number", "title"] {
            if config.get(field).is_none() {
                return Err(AppError::Validation(format!(
                    "backlog.registerPullRequest requires '{}' in config",
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
        let owner = get_required_string(&resolved, "owner")?;
        let repo = get_required_string(&resolved, "repo")?;
        let pr_number = get_required_i64(&resolved, "pr_number")?;
        let title = get_required_string(&resolved, "title")?;
        let body = get_optional_string(&resolved, "body").map(|value| value.to_string());
        let state = get_optional_string(&resolved, "state").unwrap_or("open");
        let html_url = get_optional_string(&resolved, "html_url").unwrap_or("");
        let labels = get_optional_string_list(&resolved, "labels");
        let assignees = get_optional_string_list(&resolved, "assignees");

        let backlog_item = services
            .backlog
            .sync_pull_request_to_backlog(PullRequestBacklogInput {
                owner,
                repo,
                pr_number,
                title,
                body,
                state: state.to_string(),
                html_url: html_url.to_string(),
                labels,
                assignees,
            })
            .await?;

        Ok(serde_json::json!({
            "id": backlog_item.id,
            "owner": backlog_item.owner,
            "repo": backlog_item.repo,
            "issue_number": backlog_item.issue_number,
            "title": backlog_item.title,
            "html_url": backlog_item.html_url,
            "state": backlog_item.state,
        }))
    }
}

/// Post a response comment to a pull request.
///
/// Config:
///   - `owner`: repository owner
///   - `repo`: repository name
///   - `pr_number`: pull request number
///   - `body`: markdown comment body
///
/// Output:
///   - `comment_id`: created comment id
///   - `html_url`: URL to the comment
///   - `body`: comment body
pub struct GithubRespondPullRequestNode;

#[async_trait]
impl NodeExecutor for GithubRespondPullRequestNode {
    fn node_type(&self) -> &'static str {
        "github.respondPullRequest"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["owner", "repo", "pr_number", "body"] {
            if config.get(field).is_none() {
                return Err(AppError::Validation(format!(
                    "github.respondPullRequest requires '{}' in config",
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
        let pr_number = get_required_i64(&resolved, "pr_number")?;
        let body = get_required_string(&resolved, "body")?;

        let comment = services
            .github
            .create_pull_request_comment(&owner, &repo, pr_number, &body)
            .await?;

        Ok(serde_json::json!({
            "comment_id": comment.id,
            "html_url": comment.html_url,
            "body": comment.body,
        }))
    }
}
