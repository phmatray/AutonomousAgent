use crate::errors::{AppError, Result};
use crate::services::workflow_engine::node_registry::{
    ExecutionContext, NodeExecutor, ServiceProvider,
};
use async_trait::async_trait;
use serde_json::Value;

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
        context: &mut ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let owner = config["owner"].as_str().unwrap();
        let repo = config["repo"].as_str().unwrap();
        let path = config["path"].as_str().unwrap();

        let repo_path = format!("{}/{}", path, repo);

        // Check if the repo already exists locally
        if std::path::Path::new(&repo_path).join(".git").exists() {
            services.git.pull(&repo_path).await?;
        } else {
            let url = format!("https://github.com/{}/{}.git", owner, repo);
            services.git.clone_repo(&url, &repo_path).await?;
        }

        // Set the working directory for subsequent nodes
        context.working_dir = Some(repo_path.clone());

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
            if config.get(field).is_none() {
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
        context: &mut ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config);
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
            if config.get(field).is_none() {
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
        context: &mut ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value> {
        let resolved = context.resolve_value(config);
        let owner = resolved["owner"].as_str().unwrap_or_default();
        let repo = resolved["repo"].as_str().unwrap_or_default();
        let title = resolved["title"].as_str().unwrap_or_default();
        let body = resolved["body"].as_str().unwrap_or("");
        let head = resolved["head"].as_str().unwrap_or_default();
        let base = resolved["base"].as_str().unwrap_or("develop");

        let pr = services
            .github
            .create_pull_request(owner, repo, title, body, head, base)
            .await?;

        Ok(serde_json::json!({
            "number": pr.number,
            "html_url": pr.html_url,
            "title": pr.title,
        }))
    }
}
