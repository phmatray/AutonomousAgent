//! Unit tests for Git node executors: GitWorktreeNode, GitBranchNode, GitCommitNode.
//!
//! Tests cover:
//! - Config validation (required fields, missing fields)
//! - Success cases with valid config + real temp repositories
//! - Missing working_dir dependency handling
//! - Git operation failure handling
//! - Template resolution for branch names like "feature/{{issue.number}}-fix"

#[cfg(test)]
mod tests {
    use crate::services::git_service::GitService;
    use crate::services::workflow_engine::node_registry::{
        ClaudeProvider, ExecutionContext, NodeExecutor, ServiceProvider,
    };
    use crate::services::workflow_engine::nodes::git::{
        GitBranchNode, GitCommitNode, GitWorktreeNode,
    };
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::process::Command;

    // Note: ExecutionContext fields are now private with accessor methods:
    //   - get_working_dir() / set_working_dir()
    //   - get_node_output() / set_node_output()

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn create_context() -> ExecutionContext {
        ExecutionContext::new(Value::Object(Default::default()))
    }

    fn create_context_with_working_dir(dir: &str) -> ExecutionContext {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_working_dir(Some(dir.to_string()));
        ctx
    }

    fn create_service_provider() -> ServiceProvider {
        ServiceProvider {
            github: Arc::new(crate::services::GitHubClient::new()),
            storage: Arc::new(crate::services::StorageService::new()),
            claude: Arc::new(ClaudeProvider::new())
                as Arc<dyn crate::services::workflow_engine::node_registry::ClaudeRunner>,
            git: Arc::new(GitService::new()),
        }
    }

    /// Initialize a real git repository in the given directory for testing.
    async fn init_git_repo(path: &str) {
        Command::new("git")
            .args(["init", path])
            .output()
            .await
            .expect("Failed to git init");

        // Configure user for commits
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(path)
            .output()
            .await
            .expect("Failed to set git email");

        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(path)
            .output()
            .await
            .expect("Failed to set git name");

        // Create initial commit so branches can be created
        let readme = format!("{}/README.md", path);
        std::fs::write(&readme, "# Test\n").expect("Failed to write README");

        Command::new("git")
            .args(["add", "-A"])
            .current_dir(path)
            .output()
            .await
            .expect("Failed to git add");

        Command::new("git")
            .args(["commit", "-m", "initial commit"])
            .current_dir(path)
            .output()
            .await
            .expect("Failed to git commit");
    }

    // =======================================================================
    // GitWorktreeNode tests
    // =======================================================================

    // --- Validation ---

    #[test]
    fn worktree_validate_success() {
        let node = GitWorktreeNode;
        let config = json!({
            "worktree_path": "/tmp/wt",
            "branch_name": "feature/test"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn worktree_validate_missing_worktree_path() {
        let node = GitWorktreeNode;
        let config = json!({
            "branch_name": "feature/test"
        });
        let err = node.validate(&config).unwrap_err();
        assert!(
            err.to_string().contains("worktree_path"),
            "Error should mention worktree_path: {}",
            err
        );
    }

    #[test]
    fn worktree_validate_missing_branch_name() {
        let node = GitWorktreeNode;
        let config = json!({
            "worktree_path": "/tmp/wt"
        });
        let err = node.validate(&config).unwrap_err();
        assert!(
            err.to_string().contains("branch_name"),
            "Error should mention branch_name: {}",
            err
        );
    }

    #[test]
    fn worktree_validate_empty_config() {
        let node = GitWorktreeNode;
        let config = json!({});
        assert!(node.validate(&config).is_err());
    }

    // --- Missing working_dir ---

    #[tokio::test]
    async fn worktree_execute_missing_working_dir() {
        let node = GitWorktreeNode;
        let services = create_service_provider();
        let ctx = create_context(); // no working_dir

        let config = json!({
            "worktree_path": "/tmp/wt",
            "branch_name": "feature/test"
            // no repo_path -- and no working_dir
        });

        let result = node.execute("wt1", &config, &ctx, &services).await;
        assert!(
            result.is_err(),
            "Should fail when no repo_path or working_dir"
        );
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("repo_path") || err_msg.contains("working_dir"),
            "Error should mention missing repo_path/working_dir: {}",
            err_msg
        );
    }

    // --- Success case ---

    #[tokio::test]
    async fn worktree_execute_success() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let wt_dir = tmp.path().join("my-worktree");
        let wt_path = wt_dir.to_str().unwrap();

        let node = GitWorktreeNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": repo_path,
            "worktree_path": wt_path,
            "branch_name": "feature/test-wt"
        });

        let result = node.execute("wt1", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Worktree creation should succeed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        assert_eq!(output["worktree_path"], wt_path);
        assert_eq!(output["branch_name"], "feature/test-wt");

        // Context working_dir should be updated to the worktree path
        assert_eq!(ctx.get_working_dir(), Some(wt_path.to_string()));
    }

    // --- Uses working_dir fallback ---

    #[tokio::test]
    async fn worktree_execute_uses_working_dir_fallback() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let wt_dir = tmp.path().join("wt-fallback");
        let wt_path = wt_dir.to_str().unwrap();

        let node = GitWorktreeNode;
        let services = create_service_provider();
        let ctx = create_context_with_working_dir(repo_path);

        let config = json!({
            "worktree_path": wt_path,
            "branch_name": "feature/fallback"
        });

        let result = node.execute("wt2", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Should use working_dir as repo_path: {:?}",
            result.err()
        );
        assert_eq!(result.unwrap()["branch_name"], "feature/fallback");
    }

    // --- Git failure (bad repo path) ---

    #[tokio::test]
    async fn worktree_execute_git_failure() {
        let node = GitWorktreeNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": "/nonexistent/path/to/repo",
            "worktree_path": "/tmp/bad-wt",
            "branch_name": "feature/will-fail"
        });

        let result = node.execute("wt3", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail with invalid repo path");
    }

    // --- Template resolution ---

    #[tokio::test]
    async fn worktree_execute_with_template_resolution() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let wt_dir = tmp.path().join("wt-template");
        let wt_path = wt_dir.to_str().unwrap();

        let node = GitWorktreeNode;
        let services = create_service_provider();
        let ctx = create_context();

        // Simulate a previous node's output
        ctx.set_node_output(
            "issue".to_string(),
            json!({"number": 42, "slug": "fix-login"}),
        );

        let config = json!({
            "repo_path": repo_path,
            "worktree_path": wt_path,
            "branch_name": "feature/{{issue.number}}-{{issue.slug}}"
        });

        let result = node.execute("wt4", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Template resolution should work: {:?}",
            result.err()
        );

        let output = result.unwrap();
        assert_eq!(output["branch_name"], "feature/42-fix-login");
    }

    // =======================================================================
    // GitBranchNode tests
    // =======================================================================

    // --- Validation ---

    #[test]
    fn branch_validate_success() {
        let node = GitBranchNode;
        let config = json!({
            "name": "add-login"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn branch_validate_with_type() {
        let node = GitBranchNode;
        let config = json!({
            "name": "add-login",
            "branch_type": "hotfix"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn branch_validate_missing_name() {
        let node = GitBranchNode;
        let config = json!({
            "branch_type": "feature"
        });
        let err = node.validate(&config).unwrap_err();
        assert!(
            err.to_string().contains("name"),
            "Error should mention 'name': {}",
            err
        );
    }

    #[test]
    fn branch_validate_empty_config() {
        let node = GitBranchNode;
        let config = json!({});
        assert!(node.validate(&config).is_err());
    }

    // --- Missing working_dir ---

    #[tokio::test]
    async fn branch_execute_missing_working_dir() {
        let node = GitBranchNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "name": "test-feature"
            // no repo_path and no working_dir
        });

        let result = node.execute("br1", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail without repo_path/working_dir");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("repo_path") || err_msg.contains("working_dir"),
            "Error should mention missing path: {}",
            err_msg
        );
    }

    // --- Success case ---

    #[tokio::test]
    async fn branch_execute_success_default_type() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let node = GitBranchNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": repo_path,
            "name": "add login page"
        });

        let result = node.execute("br2", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Branch creation should succeed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        // GitService::gitflow_branch_name("feature", "add login page") -> "feature/add-login-page"
        assert_eq!(output["branch_name"], "feature/add-login-page");
    }

    #[tokio::test]
    async fn branch_execute_success_hotfix_type() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let node = GitBranchNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": repo_path,
            "branch_type": "hotfix",
            "name": "critical bug"
        });

        let result = node.execute("br3", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Hotfix branch should succeed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        assert_eq!(output["branch_name"], "hotfix/critical-bug");
    }

    // --- Uses working_dir fallback ---

    #[tokio::test]
    async fn branch_execute_uses_working_dir_fallback() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let node = GitBranchNode;
        let services = create_service_provider();
        let ctx = create_context_with_working_dir(repo_path);

        let config = json!({
            "name": "from-working-dir"
        });

        let result = node.execute("br4", &config, &ctx, &services).await;
        assert!(result.is_ok(), "Should use working_dir: {:?}", result.err());
        assert_eq!(result.unwrap()["branch_name"], "feature/from-working-dir");
    }

    // --- Git failure ---

    #[tokio::test]
    async fn branch_execute_git_failure() {
        let node = GitBranchNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": "/nonexistent/repo/path",
            "name": "will-fail"
        });

        let result = node.execute("br5", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail with invalid repo path");
    }

    // --- Template resolution ---

    #[tokio::test]
    async fn branch_execute_with_template_resolution() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let node = GitBranchNode;
        let services = create_service_provider();
        let ctx = create_context();

        ctx.set_node_output(
            "issue".to_string(),
            json!({"number": 99, "title": "fix auth"}),
        );

        let config = json!({
            "repo_path": repo_path,
            "name": "{{issue.number}}-{{issue.title}}"
        });

        let result = node.execute("br6", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Template resolution should work: {:?}",
            result.err()
        );

        let output = result.unwrap();
        // After template resolution, name = "99-fix auth"
        // gitflow_branch_name("feature", "99-fix auth") -> "feature/99-fix-auth"
        assert_eq!(output["branch_name"], "feature/99-fix-auth");
    }

    #[tokio::test]
    async fn branch_execute_template_resolution_failure() {
        let node = GitBranchNode;
        let services = create_service_provider();
        let ctx = create_context();
        ctx.set_working_dir(Some("/tmp/some-repo".to_string()));

        let config = json!({
            "name": "{{missing_node.field}}"
        });

        let result = node.execute("br7", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail with unresolvable template");
    }

    // =======================================================================
    // GitCommitNode tests
    // =======================================================================

    // --- Validation ---

    #[test]
    fn commit_validate_success() {
        let node = GitCommitNode;
        let config = json!({
            "commit_type": "feat",
            "description": "add login page"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn commit_validate_with_optional_fields() {
        let node = GitCommitNode;
        let config = json!({
            "commit_type": "fix",
            "scope": "auth",
            "description": "fix token refresh",
            "gitmoji": "🚀"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn commit_validate_missing_commit_type() {
        let node = GitCommitNode;
        let config = json!({
            "description": "add login page"
        });
        let err = node.validate(&config).unwrap_err();
        assert!(
            err.to_string().contains("commit_type"),
            "Error should mention commit_type: {}",
            err
        );
    }

    #[test]
    fn commit_validate_missing_description() {
        let node = GitCommitNode;
        let config = json!({
            "commit_type": "feat"
        });
        let err = node.validate(&config).unwrap_err();
        assert!(
            err.to_string().contains("description"),
            "Error should mention description: {}",
            err
        );
    }

    #[test]
    fn commit_validate_empty_config() {
        let node = GitCommitNode;
        let config = json!({});
        assert!(node.validate(&config).is_err());
    }

    // --- Missing working_dir ---

    #[tokio::test]
    async fn commit_execute_missing_working_dir() {
        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "commit_type": "feat",
            "description": "add feature"
            // no repo_path and no working_dir
        });

        let result = node.execute("cm1", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail without repo_path/working_dir");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("repo_path") || err_msg.contains("working_dir"),
            "Error should mention missing path: {}",
            err_msg
        );
    }

    // --- Success case ---

    #[tokio::test]
    async fn commit_execute_success() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        // Create a file change to commit
        let file_path = format!("{}/new_file.txt", repo_path);
        std::fs::write(&file_path, "hello world\n").expect("Failed to write file");

        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": repo_path,
            "commit_type": "feat",
            "description": "add new file"
        });

        let result = node.execute("cm2", &config, &ctx, &services).await;
        assert!(result.is_ok(), "Commit should succeed: {:?}", result.err());

        let output = result.unwrap();
        // Should have a SHA (non-empty string)
        let sha = output["sha"].as_str().unwrap();
        assert!(!sha.is_empty(), "Commit SHA should not be empty");

        // Message should follow conventional commit format with gitmoji
        let message = output["message"].as_str().unwrap();
        assert!(
            message.contains("feat"),
            "Message should contain 'feat': {}",
            message
        );
        assert!(
            message.contains("add new file"),
            "Message should contain description: {}",
            message
        );
    }

    #[tokio::test]
    async fn commit_execute_success_with_scope_and_gitmoji() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        // Create a file change
        let file_path = format!("{}/auth.rs", repo_path);
        std::fs::write(&file_path, "fn authenticate() {}\n").expect("Failed to write file");

        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": repo_path,
            "commit_type": "fix",
            "scope": "auth",
            "description": "fix token refresh",
            "gitmoji": "🚀"
        });

        let result = node.execute("cm3", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Commit with scope should succeed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        let message = output["message"].as_str().unwrap();
        assert!(
            message.contains("fix(auth)"),
            "Message should contain 'fix(auth)': {}",
            message
        );
        assert!(
            message.starts_with("🚀"),
            "Message should start with custom gitmoji: {}",
            message
        );
    }

    // --- Uses working_dir fallback ---

    #[tokio::test]
    async fn commit_execute_uses_working_dir_fallback() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        // Create a file change
        let file_path = format!("{}/fallback.txt", repo_path);
        std::fs::write(&file_path, "fallback test\n").expect("Failed to write file");

        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context_with_working_dir(repo_path);

        let config = json!({
            "commit_type": "chore",
            "description": "add fallback file"
        });

        let result = node.execute("cm4", &config, &ctx, &services).await;
        assert!(result.is_ok(), "Should use working_dir: {:?}", result.err());

        let output = result.unwrap();
        let message = output["message"].as_str().unwrap();
        assert!(
            message.contains("chore: add fallback file"),
            "Message should match: {}",
            message
        );
    }

    // --- Git failure ---

    #[tokio::test]
    async fn commit_execute_git_failure_bad_path() {
        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": "/nonexistent/repo",
            "commit_type": "feat",
            "description": "will fail"
        });

        let result = node.execute("cm5", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail with invalid repo path");
    }

    #[tokio::test]
    async fn commit_execute_nothing_to_commit() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        // No file changes -- commit should fail
        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context();

        let config = json!({
            "repo_path": repo_path,
            "commit_type": "feat",
            "description": "nothing to commit"
        });

        let result = node.execute("cm6", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail when nothing to commit");
    }

    // --- Template resolution ---

    #[tokio::test]
    async fn commit_execute_with_template_resolution() {
        let tmp = tempfile::tempdir().expect("Failed to create temp dir");
        let repo_path = tmp.path().to_str().unwrap();
        init_git_repo(repo_path).await;

        let file_path = format!("{}/template_test.txt", repo_path);
        std::fs::write(&file_path, "template content\n").expect("Failed to write file");

        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context();

        ctx.set_node_output(
            "issue".to_string(),
            json!({"number": 42, "title": "fix login bug"}),
        );

        let config = json!({
            "repo_path": repo_path,
            "commit_type": "fix",
            "scope": "auth",
            "description": "resolve #{{issue.number}} - {{issue.title}}"
        });

        let result = node.execute("cm7", &config, &ctx, &services).await;
        assert!(
            result.is_ok(),
            "Template commit should succeed: {:?}",
            result.err()
        );

        let output = result.unwrap();
        let message = output["message"].as_str().unwrap();
        assert!(
            message.contains("resolve #42 - fix login bug"),
            "Template should resolve in description: {}",
            message
        );
    }

    #[tokio::test]
    async fn commit_execute_template_resolution_failure() {
        let node = GitCommitNode;
        let services = create_service_provider();
        let ctx = create_context();
        ctx.set_working_dir(Some("/tmp/some-repo".to_string()));

        let config = json!({
            "commit_type": "feat",
            "description": "{{nonexistent.field}}"
        });

        let result = node.execute("cm8", &config, &ctx, &services).await;
        assert!(result.is_err(), "Should fail with unresolvable template");
    }

    // =======================================================================
    // Node type identifiers
    // =======================================================================

    #[test]
    fn node_type_identifiers() {
        assert_eq!(GitWorktreeNode.node_type(), "git.worktree");
        assert_eq!(GitBranchNode.node_type(), "git.branch");
        assert_eq!(GitCommitNode.node_type(), "git.commit");
    }
}
