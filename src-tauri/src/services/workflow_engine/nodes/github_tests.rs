#[cfg(test)]
mod tests {
    use crate::errors::AppError;
    use crate::services::workflow_engine::node_registry::{
        ClaudeProvider, ExecutionContext, NodeExecutor, ServiceProvider,
    };
    use crate::services::workflow_engine::nodes::github::{
        BacklogSyncIssuesNode, GithubCreatePrNode, GithubReadIssuesNode, GithubSyncNode,
    };
    use crate::services::{GitHubClient, GitService, StorageService};
    use serde_json::json;
    use std::sync::Arc;

    /// Create a ServiceProvider with unauthenticated services for testing.
    /// GitHub calls will fail with "Not authenticated" which is useful for
    /// testing error propagation from external service failures.
    fn test_services() -> ServiceProvider {
        ServiceProvider {
            github: Arc::new(GitHubClient::new()),
            storage: Arc::new(StorageService::new()),
            claude: Arc::new(ClaudeProvider::new()),
            git: Arc::new(GitService::new()),
            backlog: Arc::new(crate::services::BacklogService::new(Arc::new(
                tokio::sync::RwLock::new(None),
            ))),
        }
    }

    fn test_context() -> ExecutionContext {
        ExecutionContext::new(json!({}))
    }

    // =========================================================================
    // GithubSyncNode
    // =========================================================================

    // --- node_type ---

    #[test]
    fn test_github_sync_node_type() {
        let node = GithubSyncNode;
        assert_eq!(node.node_type(), "github.sync");
    }

    // --- validate ---

    #[test]
    fn test_github_sync_validate_success() {
        let node = GithubSyncNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "path": "/tmp/repos"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_github_sync_validate_missing_owner() {
        let node = GithubSyncNode;
        let config = json!({
            "repo": "test-repo",
            "path": "/tmp/repos"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("owner"),
                "Error should mention 'owner', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_sync_validate_missing_repo() {
        let node = GithubSyncNode;
        let config = json!({
            "owner": "test-owner",
            "path": "/tmp/repos"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("repo"),
                "Error should mention 'repo', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_sync_validate_missing_path() {
        let node = GithubSyncNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("path"),
                "Error should mention 'path', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_sync_validate_empty_config() {
        let node = GithubSyncNode;
        let config = json!({});
        assert!(node.validate(&config).is_err());
    }

    #[test]
    fn test_github_sync_validate_null_values() {
        let node = GithubSyncNode;
        let config = json!({
            "owner": null,
            "repo": "test-repo",
            "path": "/tmp/repos"
        });
        assert!(
            node.validate(&config).is_err(),
            "Null values should not pass validation"
        );
    }

    #[test]
    fn test_github_sync_validate_non_string_values() {
        let node = GithubSyncNode;
        let config = json!({
            "owner": 123,
            "repo": "test-repo",
            "path": "/tmp/repos"
        });
        assert!(
            node.validate(&config).is_err(),
            "Non-string values should not pass validation"
        );
    }

    // --- execute ---

    #[tokio::test]
    async fn test_github_sync_execute_missing_owner_in_config() {
        let node = GithubSyncNode;
        let config = json!({
            "repo": "test-repo",
            "path": "/tmp/repos"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("sync-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should fail when owner is missing");
    }

    #[tokio::test]
    async fn test_github_sync_execute_missing_repo_in_config() {
        let node = GithubSyncNode;
        let config = json!({
            "owner": "test-owner",
            "path": "/tmp/repos"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("sync-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should fail when repo is missing");
    }

    #[tokio::test]
    async fn test_github_sync_execute_missing_path_in_config() {
        let node = GithubSyncNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("sync-1", &config, &context, &services).await;
        assert!(result.is_err(), "Should fail when path is missing");
    }

    #[tokio::test]
    async fn test_github_sync_execute_clone_failure() {
        // Uses unauthenticated GitService which will fail on clone
        let node = GithubSyncNode;
        let config = json!({
            "owner": "nonexistent-owner",
            "repo": "nonexistent-repo",
            "path": "/tmp/test-autonomous-agent-nonexistent"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("sync-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail when cloning a nonexistent repository"
        );
    }

    // =========================================================================
    // GithubReadIssuesNode
    // =========================================================================

    // --- node_type ---

    #[test]
    fn test_github_read_issues_node_type() {
        let node = GithubReadIssuesNode;
        assert_eq!(node.node_type(), "github.readIssues");
    }

    // --- validate ---

    #[test]
    fn test_github_read_issues_validate_success() {
        let node = GithubReadIssuesNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_github_read_issues_validate_missing_owner() {
        let node = GithubReadIssuesNode;
        let config = json!({
            "repo": "test-repo"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("owner"),
                "Error should mention 'owner', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_read_issues_validate_missing_repo() {
        let node = GithubReadIssuesNode;
        let config = json!({
            "owner": "test-owner"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("repo"),
                "Error should mention 'repo', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_read_issues_validate_empty_config() {
        let node = GithubReadIssuesNode;
        let config = json!({});
        assert!(node.validate(&config).is_err());
    }

    #[test]
    fn test_github_read_issues_validate_non_string_owner() {
        let node = GithubReadIssuesNode;
        let config = json!({
            "owner": 42,
            "repo": "test-repo"
        });
        assert!(
            node.validate(&config).is_err(),
            "Non-string owner should fail validation"
        );
    }

    // --- execute ---

    #[tokio::test]
    async fn test_github_read_issues_execute_unauthenticated_fails() {
        let node = GithubReadIssuesNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("read-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail when GitHub client is not authenticated"
        );
    }

    #[tokio::test]
    async fn test_github_read_issues_execute_with_template_resolution() {
        let node = GithubReadIssuesNode;
        // Config references outputs from a previous node
        let config = json!({
            "owner": "{{sync.owner}}",
            "repo": "{{sync.repo}}"
        });
        let context = test_context();
        // Set up the referenced node outputs
        context.set_node_output(
            "sync".into(),
            json!({
                "owner": "resolved-owner",
                "repo": "resolved-repo"
            }),
        );
        let services = test_services();

        // The template resolution should succeed, but the GitHub call should fail
        // (unauthenticated client). This tests that template resolution works
        // before the service call.
        let result = node.execute("read-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail at GitHub API call (not at template resolution)"
        );
        // Verify the error is from authentication, not template resolution
        let err = result.unwrap_err();
        let err_msg = format!("{}", err);
        assert!(
            !err_msg.contains("Template resolution"),
            "Error should NOT be from template resolution; got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_github_read_issues_execute_with_missing_template_ref() {
        let node = GithubReadIssuesNode;
        let config = json!({
            "owner": "{{nonexistent.owner}}",
            "repo": "test-repo"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("read-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail on unresolved template reference"
        );
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("nonexistent")
                || err_msg.contains("Template")
                || err_msg.contains("resolution"),
            "Error should indicate template resolution failure; got: {}",
            err_msg
        );
    }

    // =========================================================================
    // BacklogSyncIssuesNode
    // =========================================================================

    // --- node_type ---

    #[test]
    fn test_backlog_sync_issues_node_type() {
        let node = BacklogSyncIssuesNode;
        assert_eq!(node.node_type(), "backlog.syncIssues");
    }

    // --- validate ---

    #[test]
    fn test_backlog_sync_issues_validate_success() {
        let node = BacklogSyncIssuesNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_backlog_sync_issues_validate_missing_owner() {
        let node = BacklogSyncIssuesNode;
        let config = json!({
            "repo": "test-repo"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("owner"),
                "Error should mention 'owner', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_backlog_sync_issues_validate_missing_repo() {
        let node = BacklogSyncIssuesNode;
        let config = json!({
            "owner": "test-owner"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("repo"),
                "Error should mention 'repo', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    // --- execute ---

    #[tokio::test]
    async fn test_backlog_sync_issues_execute_unauthenticated_fails() {
        let node = BacklogSyncIssuesNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo"
        });
        let context = test_context();
        let services = test_services();

        let result = node
            .execute("backlog-sync-1", &config, &context, &services)
            .await;
        assert!(
            result.is_err(),
            "Should fail when GitHub client is not authenticated"
        );
    }

    #[tokio::test]
    async fn test_backlog_sync_issues_execute_with_template_resolution() {
        let node = BacklogSyncIssuesNode;
        let config = json!({
            "owner": "{{sync.owner}}",
            "repo": "{{sync.repo}}"
        });
        let context = test_context();
        context.set_node_output(
            "sync".into(),
            json!({
                "owner": "resolved-owner",
                "repo": "resolved-repo"
            }),
        );
        let services = test_services();

        let result = node
            .execute("backlog-sync-1", &config, &context, &services)
            .await;
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            !err_msg.contains("Template resolution"),
            "Error should NOT be from template resolution; got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_backlog_sync_issues_execute_with_missing_template_ref() {
        let node = BacklogSyncIssuesNode;
        let config = json!({
            "owner": "{{nonexistent.owner}}",
            "repo": "test-repo"
        });
        let context = test_context();
        let services = test_services();

        let result = node
            .execute("backlog-sync-1", &config, &context, &services)
            .await;
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            err_msg.contains("nonexistent")
                || err_msg.contains("Template")
                || err_msg.contains("resolution"),
            "Error should indicate template resolution failure; got: {}",
            err_msg
        );
    }

    // =========================================================================
    // GithubCreatePrNode
    // =========================================================================

    // --- node_type ---

    #[test]
    fn test_github_create_pr_node_type() {
        let node = GithubCreatePrNode;
        assert_eq!(node.node_type(), "github.createPR");
    }

    // --- validate ---

    #[test]
    fn test_github_create_pr_validate_success() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "title": "Fix bug",
            "head": "feature/fix-123"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_github_create_pr_validate_with_optional_fields() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "title": "Fix bug",
            "head": "feature/fix-123",
            "body": "This PR fixes issue #123",
            "base": "main"
        });
        assert!(node.validate(&config).is_ok());
    }

    #[test]
    fn test_github_create_pr_validate_missing_owner() {
        let node = GithubCreatePrNode;
        let config = json!({
            "repo": "test-repo",
            "title": "Fix bug",
            "head": "feature/fix-123"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("owner"),
                "Error should mention 'owner', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_create_pr_validate_missing_repo() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "title": "Fix bug",
            "head": "feature/fix-123"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("repo"),
                "Error should mention 'repo', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_create_pr_validate_missing_title() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "head": "feature/fix-123"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("title"),
                "Error should mention 'title', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_create_pr_validate_missing_head() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "title": "Fix bug"
        });
        let err = node.validate(&config).unwrap_err();
        match &err {
            AppError::Validation(msg) => assert!(
                msg.contains("head"),
                "Error should mention 'head', got: {}",
                msg
            ),
            other => panic!("Expected Validation error, got: {:?}", other),
        }
    }

    #[test]
    fn test_github_create_pr_validate_empty_config() {
        let node = GithubCreatePrNode;
        let config = json!({});
        assert!(node.validate(&config).is_err());
    }

    #[test]
    fn test_github_create_pr_validate_all_missing() {
        let node = GithubCreatePrNode;
        let config = json!(null);
        assert!(node.validate(&config).is_err());
    }

    // --- execute ---

    #[tokio::test]
    async fn test_github_create_pr_execute_unauthenticated_fails() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "title": "Fix bug #123",
            "body": "Resolves issue #123",
            "head": "feature/fix-123",
            "base": "develop"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("pr-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail when GitHub client is not authenticated"
        );
    }

    #[tokio::test]
    async fn test_github_create_pr_execute_with_template_resolution() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "{{sync.owner}}",
            "repo": "{{sync.repo}}",
            "title": "Fix issue #{{issue.number}}",
            "body": "Resolves #{{issue.number}}",
            "head": "feature/fix-{{issue.number}}",
            "base": "develop"
        });
        let context = test_context();
        context.set_node_output(
            "sync".into(),
            json!({
                "owner": "resolved-owner",
                "repo": "resolved-repo"
            }),
        );
        context.set_node_output(
            "issue".into(),
            json!({
                "number": 42
            }),
        );
        let services = test_services();

        // Template resolution should succeed; GitHub call should fail (unauthenticated)
        let result = node.execute("pr-1", &config, &context, &services).await;
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            !err_msg.contains("Template resolution"),
            "Error should NOT be from template resolution; got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_github_create_pr_execute_with_missing_template_ref() {
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "{{missing_node.owner}}",
            "repo": "test-repo",
            "title": "Fix bug",
            "head": "feature/fix",
            "base": "develop"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("pr-1", &config, &context, &services).await;
        assert!(
            result.is_err(),
            "Should fail on unresolved template reference"
        );
    }

    #[tokio::test]
    async fn test_github_create_pr_execute_default_base_branch() {
        // Verify that when `base` is not specified, the node still processes
        // (will fail at GitHub API, but should not fail at config extraction)
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "title": "Fix bug",
            "head": "feature/fix-123"
            // No "base" field - should default to "develop"
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("pr-1", &config, &context, &services).await;
        // Should fail at GitHub API, not at config extraction
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            !err_msg.contains("base"),
            "Error should not be about missing 'base'; got: {}",
            err_msg
        );
    }

    #[tokio::test]
    async fn test_github_create_pr_execute_default_body_empty() {
        // Verify that when `body` is not specified, the node still processes
        let node = GithubCreatePrNode;
        let config = json!({
            "owner": "test-owner",
            "repo": "test-repo",
            "title": "Fix bug",
            "head": "feature/fix-123"
            // No "body" field - should default to ""
        });
        let context = test_context();
        let services = test_services();

        let result = node.execute("pr-1", &config, &context, &services).await;
        // Should fail at GitHub API, not at config extraction
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(
            !err_msg.contains("body"),
            "Error should not be about missing 'body'; got: {}",
            err_msg
        );
    }
}
