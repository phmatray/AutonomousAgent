//! Test utilities for backend testing.
//!
//! Provides mock service implementations, factory functions for test data,
//! and helpers for creating `ExecutionContext` and `ServiceProvider` instances.

#![allow(dead_code)]

use crate::errors::{AppError, Result};
use crate::models::workflow::{NodePosition, Workflow, WorkflowEdge, WorkflowNode};
use crate::services::git_service::{GitLogEntry, GitStatus, WorktreeInfo};
use crate::services::github_client::{GithubIssue, GithubRepo, GithubUser, PullRequestInfo};
use crate::services::workflow_engine::node_registry::{
    ClaudeProvider, ClaudeRunner, ExecutionContext, ServiceProvider,
};
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

// ---------------------------------------------------------------------------
// Mock GitHub Client
// ---------------------------------------------------------------------------

/// A mock GitHub client that returns configurable responses for testing.
/// Wrap the real `GitHubClient` struct for the `ServiceProvider`, but
/// provide standalone mock functions for unit test assertions.
pub struct MockGitHubClient {
    pub issues: Arc<RwLock<Vec<GithubIssue>>>,
    pub repos: Arc<RwLock<Vec<GithubRepo>>>,
    pub created_prs: Arc<RwLock<Vec<PullRequestInfo>>>,
    pub should_fail: Arc<RwLock<bool>>,
    pub error_message: Arc<RwLock<String>>,
}

impl MockGitHubClient {
    pub fn new() -> Self {
        Self {
            issues: Arc::new(RwLock::new(Vec::new())),
            repos: Arc::new(RwLock::new(Vec::new())),
            created_prs: Arc::new(RwLock::new(Vec::new())),
            should_fail: Arc::new(RwLock::new(false)),
            error_message: Arc::new(RwLock::new("Mock error".to_string())),
        }
    }

    /// Configure the mock to fail on all operations.
    pub async fn set_should_fail(&self, fail: bool, message: &str) {
        *self.should_fail.write().await = fail;
        *self.error_message.write().await = message.to_string();
    }

    /// Set the list of issues to return from `list_issues`.
    pub async fn set_issues(&self, issues: Vec<GithubIssue>) {
        *self.issues.write().await = issues;
    }

    /// Set the list of repos to return from `list_repositories`.
    pub async fn set_repos(&self, repos: Vec<GithubRepo>) {
        *self.repos.write().await = repos;
    }

    pub async fn list_issues(&self, _owner: &str, _repo: &str) -> Result<Vec<GithubIssue>> {
        if *self.should_fail.read().await {
            return Err(AppError::GitHub(self.error_message.read().await.clone()));
        }
        Ok(self.issues.read().await.clone())
    }

    pub async fn list_repositories(&self) -> Result<Vec<GithubRepo>> {
        if *self.should_fail.read().await {
            return Err(AppError::GitHub(self.error_message.read().await.clone()));
        }
        Ok(self.repos.read().await.clone())
    }

    pub async fn create_pull_request(
        &self,
        _owner: &str,
        _repo: &str,
        title: &str,
        _body: &str,
        _head: &str,
        _base: &str,
    ) -> Result<PullRequestInfo> {
        if *self.should_fail.read().await {
            return Err(AppError::GitHub(self.error_message.read().await.clone()));
        }
        let pr = PullRequestInfo {
            number: (self.created_prs.read().await.len() + 1) as i64,
            html_url: format!(
                "https://github.com/test/test/pull/{}",
                self.created_prs.read().await.len() + 1
            ),
            title: title.to_string(),
        };
        self.created_prs.write().await.push(pr.clone());
        Ok(pr)
    }

    pub async fn get_default_branch_sha(&self, _owner: &str, _repo: &str) -> Result<String> {
        if *self.should_fail.read().await {
            return Err(AppError::GitHub(self.error_message.read().await.clone()));
        }
        Ok("abc123def456".to_string())
    }
}

// ---------------------------------------------------------------------------
// Mock Claude Provider
// ---------------------------------------------------------------------------

/// A mock Claude provider that returns configurable prompt responses.
pub struct MockClaudeProvider {
    pub responses: Arc<RwLock<HashMap<String, String>>>,
    pub default_response: Arc<RwLock<String>>,
    pub should_fail: Arc<RwLock<bool>>,
    pub error_message: Arc<RwLock<String>>,
    pub call_log: Arc<RwLock<Vec<String>>>,
}

impl MockClaudeProvider {
    pub fn new() -> Self {
        Self {
            responses: Arc::new(RwLock::new(HashMap::new())),
            default_response: Arc::new(RwLock::new(
                "Mock Claude response: Task completed successfully.".to_string(),
            )),
            should_fail: Arc::new(RwLock::new(false)),
            error_message: Arc::new(RwLock::new("Claude CLI failed".to_string())),
            call_log: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// Configure the mock to fail on all operations.
    pub async fn set_should_fail(&self, fail: bool, message: &str) {
        *self.should_fail.write().await = fail;
        *self.error_message.write().await = message.to_string();
    }

    /// Set a canned response for a specific prompt substring.
    pub async fn set_response(&self, prompt_contains: &str, response: &str) {
        self.responses
            .write()
            .await
            .insert(prompt_contains.to_string(), response.to_string());
    }

    /// Set the default response for prompts that don't match any configured pattern.
    pub async fn set_default_response(&self, response: &str) {
        *self.default_response.write().await = response.to_string();
    }

    /// Simulate running a prompt (mirrors `ClaudeProvider::run_prompt` signature).
    pub async fn run_prompt(
        &self,
        prompt: &str,
        _working_dir: Option<&str>,
        _timeout_secs: Option<u64>,
    ) -> Result<String> {
        self.call_log.write().await.push(prompt.to_string());

        if *self.should_fail.read().await {
            return Err(AppError::Unknown(self.error_message.read().await.clone()));
        }

        let responses = self.responses.read().await;
        for (pattern, response) in responses.iter() {
            if prompt.contains(pattern) {
                return Ok(response.clone());
            }
        }
        Ok(self.default_response.read().await.clone())
    }

    /// Return all prompts that were sent to this mock.
    pub async fn get_call_log(&self) -> Vec<String> {
        self.call_log.read().await.clone()
    }
}

#[async_trait]
impl ClaudeRunner for MockClaudeProvider {
    async fn run_prompt(
        &self,
        prompt: &str,
        working_dir: Option<&str>,
        timeout_secs: Option<u64>,
    ) -> Result<String> {
        MockClaudeProvider::run_prompt(self, prompt, working_dir, timeout_secs).await
    }
}

// ---------------------------------------------------------------------------
// Mock Git Service
// ---------------------------------------------------------------------------

/// A mock git service for testing git operations without a real repository.
pub struct MockGitService {
    pub status: Arc<RwLock<GitStatus>>,
    pub log_entries: Arc<RwLock<Vec<GitLogEntry>>>,
    pub head_sha: Arc<RwLock<String>>,
    pub worktrees: Arc<RwLock<Vec<WorktreeInfo>>>,
    pub should_fail: Arc<RwLock<bool>>,
    pub error_message: Arc<RwLock<String>>,
    pub commit_log: Arc<RwLock<Vec<(String, String)>>>,
}

impl MockGitService {
    pub fn new() -> Self {
        Self {
            status: Arc::new(RwLock::new(GitStatus {
                branch: "main".to_string(),
                is_clean: true,
                modified: Vec::new(),
                staged: Vec::new(),
                untracked: Vec::new(),
            })),
            log_entries: Arc::new(RwLock::new(Vec::new())),
            head_sha: Arc::new(RwLock::new("abc123".to_string())),
            worktrees: Arc::new(RwLock::new(Vec::new())),
            should_fail: Arc::new(RwLock::new(false)),
            error_message: Arc::new(RwLock::new("Git error".to_string())),
            commit_log: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn set_should_fail(&self, fail: bool, message: &str) {
        *self.should_fail.write().await = fail;
        *self.error_message.write().await = message.to_string();
    }

    pub async fn set_status(&self, status: GitStatus) {
        *self.status.write().await = status;
    }

    pub async fn set_head_sha(&self, sha: &str) {
        *self.head_sha.write().await = sha.to_string();
    }

    pub fn status(&self, _repo_path: &str) -> Result<GitStatus> {
        // Synchronous -- uses try_read for non-async context
        Ok(GitStatus {
            branch: "main".to_string(),
            is_clean: true,
            modified: Vec::new(),
            staged: Vec::new(),
            untracked: Vec::new(),
        })
    }

    pub fn get_head_sha(&self, _repo_path: &str) -> Result<String> {
        Ok("abc123".to_string())
    }

    pub async fn create_worktree(
        &self,
        _repo_path: &str,
        worktree_path: &str,
        branch_name: &str,
    ) -> Result<()> {
        if *self.should_fail.read().await {
            return Err(AppError::Git(git2::Error::from_str(
                &self.error_message.read().await,
            )));
        }
        self.worktrees.write().await.push(WorktreeInfo {
            path: worktree_path.to_string(),
            branch: branch_name.to_string(),
        });
        Ok(())
    }

    pub async fn create_branch(&self, _repo_path: &str, _branch_name: &str) -> Result<()> {
        if *self.should_fail.read().await {
            return Err(AppError::Git(git2::Error::from_str(
                &self.error_message.read().await,
            )));
        }
        Ok(())
    }

    pub async fn add_all(&self, _repo_path: &str) -> Result<()> {
        if *self.should_fail.read().await {
            return Err(AppError::Git(git2::Error::from_str(
                &self.error_message.read().await,
            )));
        }
        Ok(())
    }

    pub async fn commit(&self, repo_path: &str, message: &str) -> Result<String> {
        if *self.should_fail.read().await {
            return Err(AppError::Git(git2::Error::from_str(
                &self.error_message.read().await,
            )));
        }
        self.commit_log
            .write()
            .await
            .push((repo_path.to_string(), message.to_string()));
        Ok(self.head_sha.read().await.clone())
    }

    pub async fn push(&self, _repo_path: &str, _branch_name: &str) -> Result<()> {
        if *self.should_fail.read().await {
            return Err(AppError::Git(git2::Error::from_str(
                &self.error_message.read().await,
            )));
        }
        Ok(())
    }

    pub async fn pull(&self, _repo_path: &str) -> Result<()> {
        if *self.should_fail.read().await {
            return Err(AppError::Git(git2::Error::from_str(
                &self.error_message.read().await,
            )));
        }
        Ok(())
    }

    pub async fn clone_repo(&self, _url: &str, _target_path: &str) -> Result<()> {
        if *self.should_fail.read().await {
            return Err(AppError::Git(git2::Error::from_str(
                &self.error_message.read().await,
            )));
        }
        Ok(())
    }

    /// Return all commits that were recorded by this mock.
    pub async fn get_commit_log(&self) -> Vec<(String, String)> {
        self.commit_log.read().await.clone()
    }
}

// ---------------------------------------------------------------------------
// Factory functions for test data
// ---------------------------------------------------------------------------

/// Create a minimal `ExecutionContext` with empty config.
pub fn create_test_context() -> ExecutionContext {
    ExecutionContext::new(Value::Object(Default::default()))
}

/// Create an `ExecutionContext` with the given config and optional working directory.
pub fn create_test_context_with_config(
    config: Value,
    working_dir: Option<String>,
) -> ExecutionContext {
    let ctx = ExecutionContext::new(config);
    ctx.set_working_dir(working_dir);
    ctx
}

/// Create a `ServiceProvider` with real service instances (no network calls).
/// This is suitable for tests that only exercise in-memory logic.
pub fn create_test_service_provider() -> ServiceProvider {
    ServiceProvider {
        github: Arc::new(crate::services::GitHubClient::new()),
        storage: Arc::new(crate::services::StorageService::new()),
        claude: Arc::new(ClaudeProvider::new()),
        git: Arc::new(crate::services::GitService::new()),
        backlog: Arc::new(crate::services::BacklogService::new(Arc::new(
            tokio::sync::RwLock::new(None),
        ))),
    }
}

/// Create a `ServiceProvider` with a mock Claude provider for testing Claude nodes.
pub fn create_test_service_provider_with_mock_claude(
    mock_claude: Arc<MockClaudeProvider>,
) -> ServiceProvider {
    ServiceProvider {
        github: Arc::new(crate::services::GitHubClient::new()),
        storage: Arc::new(crate::services::StorageService::new()),
        claude: mock_claude,
        git: Arc::new(crate::services::GitService::new()),
        backlog: Arc::new(crate::services::BacklogService::new(Arc::new(
            tokio::sync::RwLock::new(None),
        ))),
    }
}

/// Create a simple test workflow with the given nodes and edges.
pub fn create_test_workflow(
    id: &str,
    name: &str,
    nodes: Vec<WorkflowNode>,
    edges: Vec<WorkflowEdge>,
) -> Workflow {
    let now = chrono::Utc::now().to_rfc3339();
    Workflow {
        id: id.to_string(),
        name: name.to_string(),
        description: Some(format!("Test workflow: {}", name)),
        status: "draft".to_string(),
        nodes,
        edges,
        config: None,
        version: 1,
        created_at: now.clone(),
        updated_at: now,
    }
}

/// Create a test `WorkflowNode`.
pub fn create_test_node(id: &str, node_type: &str, config: Option<Value>) -> WorkflowNode {
    WorkflowNode {
        id: id.to_string(),
        node_type: node_type.to_string(),
        config,
        inputs: None,
        position: Some(NodePosition { x: 0.0, y: 0.0 }),
    }
}

/// Create a test `WorkflowEdge`.
pub fn create_test_edge(id: &str, source: &str, target: &str) -> WorkflowEdge {
    WorkflowEdge {
        id: id.to_string(),
        source: source.to_string(),
        target: target.to_string(),
        source_handle: None,
        target_handle: None,
    }
}

/// Create a test `GithubIssue`.
pub fn create_test_issue(number: i64, title: &str, body: Option<&str>) -> GithubIssue {
    GithubIssue {
        number,
        title: title.to_string(),
        body: body.map(|b| b.to_string()),
        state: "open".to_string(),
        labels: Vec::new(),
        assignees: Vec::new(),
    }
}

/// Create a test `GithubRepo`.
pub fn create_test_repo(name: &str, owner: &str) -> GithubRepo {
    GithubRepo {
        id: 1,
        name: name.to_string(),
        full_name: format!("{}/{}", owner, name),
        owner: owner.to_string(),
        description: Some(format!("Test repo: {}", name)),
        default_branch: "main".to_string(),
        private: false,
    }
}

/// Create a test `GithubUser`.
pub fn create_test_user(login: &str) -> GithubUser {
    GithubUser {
        login: login.to_string(),
        name: Some(format!("Test User {}", login)),
        avatar_url: format!("https://github.com/{}.png", login),
    }
}

/// Create a simple linear workflow: trigger -> node_a -> node_b -> ...
pub fn create_linear_workflow(
    id: &str,
    node_types: &[(&str, &str)], // (node_id, node_type)
) -> Workflow {
    let nodes: Vec<WorkflowNode> = node_types
        .iter()
        .map(|(nid, ntype)| create_test_node(nid, ntype, None))
        .collect();

    let edges: Vec<WorkflowEdge> = node_types
        .windows(2)
        .enumerate()
        .map(|(i, pair)| create_test_edge(&format!("e{}", i + 1), pair[0].0, pair[1].0))
        .collect();

    create_test_workflow(id, &format!("Linear workflow {}", id), nodes, edges)
}

// ---------------------------------------------------------------------------
// Tests for test utilities themselves
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_test_context() {
        let ctx = create_test_context();
        assert!(ctx.get_working_dir().is_none());
        assert!(ctx.get_node_output("any").is_none());
    }

    #[test]
    fn test_create_test_context_with_config() {
        let config = serde_json::json!({"repo": "test"});
        let ctx = create_test_context_with_config(config.clone(), Some("/tmp/test".to_string()));
        assert_eq!(ctx.config, config);
        assert_eq!(ctx.get_working_dir(), Some("/tmp/test".to_string()));
    }

    #[test]
    fn test_create_test_node() {
        let node = create_test_node("n1", "trigger", None);
        assert_eq!(node.id, "n1");
        assert_eq!(node.node_type, "trigger");
        assert!(node.config.is_none());
    }

    #[test]
    fn test_create_test_edge() {
        let edge = create_test_edge("e1", "a", "b");
        assert_eq!(edge.source, "a");
        assert_eq!(edge.target, "b");
    }

    #[test]
    fn test_create_test_workflow() {
        let wf = create_test_workflow(
            "wf1",
            "Test",
            vec![create_test_node("a", "trigger", None)],
            Vec::new(),
        );
        assert_eq!(wf.id, "wf1");
        assert_eq!(wf.nodes.len(), 1);
    }

    #[test]
    fn test_create_linear_workflow() {
        let wf = create_linear_workflow(
            "linear1",
            &[
                ("trigger", "trigger"),
                ("sync", "github.sync"),
                ("plan", "claude.plan"),
            ],
        );
        assert_eq!(wf.nodes.len(), 3);
        assert_eq!(wf.edges.len(), 2);
        assert_eq!(wf.edges[0].source, "trigger");
        assert_eq!(wf.edges[0].target, "sync");
        assert_eq!(wf.edges[1].source, "sync");
        assert_eq!(wf.edges[1].target, "plan");
    }

    #[test]
    fn test_create_test_issue() {
        let issue = create_test_issue(42, "Fix login bug", Some("Detailed description"));
        assert_eq!(issue.number, 42);
        assert_eq!(issue.title, "Fix login bug");
        assert_eq!(issue.body.unwrap(), "Detailed description");
        assert_eq!(issue.state, "open");
    }

    #[test]
    fn test_create_test_repo() {
        let repo = create_test_repo("my-repo", "testuser");
        assert_eq!(repo.full_name, "testuser/my-repo");
        assert_eq!(repo.default_branch, "main");
        assert!(!repo.private);
    }

    #[test]
    fn test_create_test_user() {
        let user = create_test_user("testuser");
        assert_eq!(user.login, "testuser");
        assert!(user.avatar_url.contains("testuser"));
    }

    #[tokio::test]
    async fn test_mock_github_client_success() {
        let mock = MockGitHubClient::new();
        mock.set_issues(vec![
            create_test_issue(1, "Issue 1", None),
            create_test_issue(2, "Issue 2", Some("body")),
        ])
        .await;

        let issues = mock.list_issues("owner", "repo").await.unwrap();
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].number, 1);
    }

    #[tokio::test]
    async fn test_mock_github_client_failure() {
        let mock = MockGitHubClient::new();
        mock.set_should_fail(true, "API rate limit exceeded").await;

        let result = mock.list_issues("owner", "repo").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("rate limit"));
    }

    #[tokio::test]
    async fn test_mock_github_create_pr() {
        let mock = MockGitHubClient::new();
        let pr = mock
            .create_pull_request(
                "owner",
                "repo",
                "Fix bug",
                "Description",
                "feature/fix",
                "main",
            )
            .await
            .unwrap();
        assert_eq!(pr.number, 1);
        assert_eq!(pr.title, "Fix bug");

        let created = mock.created_prs.read().await;
        assert_eq!(created.len(), 1);
    }

    #[tokio::test]
    async fn test_mock_claude_provider_default_response() {
        let mock = MockClaudeProvider::new();
        let result = mock
            .run_prompt("Analyze this code", None, None)
            .await
            .unwrap();
        assert!(result.contains("Mock Claude response"));
    }

    #[tokio::test]
    async fn test_mock_claude_provider_custom_response() {
        let mock = MockClaudeProvider::new();
        mock.set_response("analyze", "Analysis complete: no issues found")
            .await;

        let result = mock
            .run_prompt("Please analyze the codebase", None, None)
            .await
            .unwrap();
        assert_eq!(result, "Analysis complete: no issues found");
    }

    #[tokio::test]
    async fn test_mock_claude_provider_failure() {
        let mock = MockClaudeProvider::new();
        mock.set_should_fail(true, "Claude CLI not found").await;

        let result = mock.run_prompt("Do something", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_mock_claude_provider_call_log() {
        let mock = MockClaudeProvider::new();
        mock.run_prompt("First prompt", None, None).await.unwrap();
        mock.run_prompt("Second prompt", None, None).await.unwrap();

        let log = mock.get_call_log().await;
        assert_eq!(log.len(), 2);
        assert_eq!(log[0], "First prompt");
        assert_eq!(log[1], "Second prompt");
    }

    #[tokio::test]
    async fn test_mock_git_service_commit() {
        let mock = MockGitService::new();
        let sha = mock.commit("/tmp/repo", "feat: add feature").await.unwrap();
        assert_eq!(sha, "abc123");

        let log = mock.get_commit_log().await;
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].1, "feat: add feature");
    }

    #[tokio::test]
    async fn test_mock_git_service_failure() {
        let mock = MockGitService::new();
        mock.set_should_fail(true, "Repository not found").await;

        let result = mock.create_branch("/tmp/repo", "feature/test").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_mock_git_service_worktree() {
        let mock = MockGitService::new();
        mock.create_worktree("/tmp/repo", "/tmp/worktree", "feature/test")
            .await
            .unwrap();

        let worktrees = mock.worktrees.read().await;
        assert_eq!(worktrees.len(), 1);
        assert_eq!(worktrees[0].branch, "feature/test");
    }
}
