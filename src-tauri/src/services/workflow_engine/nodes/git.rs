use crate::errors::{AppError, Result};
use crate::services::git_service::GitService;
use crate::services::workflow_engine::node_registry::{
    ExecutionContext, NodeExecutor, ServiceProvider,
};
use async_trait::async_trait;
use serde_json::Value;

/// Create a git worktree for isolated work.
///
/// Config:
///   - `repo_path`: path to the main repository (or uses context.working_dir)
///   - `worktree_path`: path for the new worktree
///   - `branch_name`: branch to create in the worktree
///
/// Output:
///   - `worktree_path`: the created worktree path
///   - `branch_name`: the branch created
pub struct GitWorktreeNode;

#[async_trait]
impl NodeExecutor for GitWorktreeNode {
    fn node_type(&self) -> &'static str {
        "git.worktree"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["worktree_path", "branch_name"] {
            if config.get(field).is_none() {
                return Err(AppError::Validation(format!(
                    "git.worktree requires '{}' in config",
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
        let repo_path = resolved["repo_path"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| context.get_working_dir())
            .ok_or_else(|| AppError::Validation("No repo_path or working_dir set".into()))?;
        let worktree_path = resolved["worktree_path"].as_str().unwrap_or_default();
        let branch_name = resolved["branch_name"].as_str().unwrap_or_default();

        services
            .git
            .create_worktree(&repo_path, worktree_path, branch_name)
            .await?;

        // Update working dir to the worktree so subsequent nodes operate there
        context.set_working_dir(Some(worktree_path.to_string()));

        Ok(serde_json::json!({
            "worktree_path": worktree_path,
            "branch_name": branch_name,
        }))
    }
}

/// Create a feature branch following gitflow naming conventions.
///
/// Config:
///   - `repo_path`: path to the repository (or uses context.working_dir)
///   - `branch_type`: "feature", "hotfix", or "release" (default: "feature")
///   - `name`: descriptive name for the branch
///
/// Output:
///   - `branch_name`: the full gitflow branch name (e.g. "feature/my-feature")
pub struct GitBranchNode;

#[async_trait]
impl NodeExecutor for GitBranchNode {
    fn node_type(&self) -> &'static str {
        "git.branch"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        if config.get("name").is_none() {
            return Err(AppError::Validation(
                "git.branch requires 'name' in config".into(),
            ));
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
        let repo_path = resolved["repo_path"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| context.get_working_dir())
            .ok_or_else(|| AppError::Validation("No repo_path or working_dir set".into()))?;
        let branch_type = resolved["branch_type"].as_str().unwrap_or("feature");
        let name = resolved["name"].as_str().unwrap_or_default();

        let branch_name = GitService::gitflow_branch_name(branch_type, name);

        services.git.create_branch(&repo_path, &branch_name).await?;

        Ok(serde_json::json!({
            "branch_name": branch_name,
        }))
    }
}

/// Stage all changes and commit with conventional commit + gitmoji format.
///
/// Config:
///   - `repo_path`: path to the repository (or uses context.working_dir)
///   - `commit_type`: conventional commit type (feat, fix, docs, etc.)
///   - `scope`: optional commit scope
///   - `description`: commit message description
///   - `gitmoji`: optional gitmoji override
///
/// Output:
///   - `sha`: the commit SHA
///   - `message`: the full commit message
pub struct GitCommitNode;

#[async_trait]
impl NodeExecutor for GitCommitNode {
    fn node_type(&self) -> &'static str {
        "git.commit"
    }

    fn validate(&self, config: &Value) -> Result<()> {
        for field in &["commit_type", "description"] {
            if config.get(field).is_none() {
                return Err(AppError::Validation(format!(
                    "git.commit requires '{}' in config",
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
        let repo_path = resolved["repo_path"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| context.get_working_dir())
            .ok_or_else(|| AppError::Validation("No repo_path or working_dir set".into()))?;
        let commit_type = resolved["commit_type"].as_str().unwrap_or("feat");
        let scope = resolved["scope"].as_str();
        let description = resolved["description"].as_str().unwrap_or_default();
        let gitmoji = resolved["gitmoji"].as_str();

        let message = GitService::conventional_commit(commit_type, scope, description, gitmoji);

        // Stage all changes first
        services.git.add_all(&repo_path).await?;

        // Commit
        let sha = services.git.commit(&repo_path, &message).await?;

        Ok(serde_json::json!({
            "sha": sha,
            "message": message,
        }))
    }
}
