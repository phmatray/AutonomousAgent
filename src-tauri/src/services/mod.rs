pub mod backlog_service;
pub mod claude_executor;
pub mod git_service;
pub mod github_client;
pub mod storage;
pub mod workflow_engine;

pub use backlog_service::BacklogService;
pub use claude_executor::ClaudeExecutor;
pub use git_service::GitService;
pub use github_client::GitHubClient;
pub use storage::StorageService;
pub use workflow_engine::WorkflowEngine;

use serde::Serialize;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Tracks whether critical subsystems have finished initializing.
#[derive(Clone, Serialize)]
pub struct InitializationState {
    pub database: bool,
    pub github_auth_attempted: bool,
}

impl InitializationState {
    pub fn new() -> Self {
        Self {
            database: false,
            github_auth_attempted: false,
        }
    }
}

/// Application state containing all services, shared via Tauri's managed state.
pub struct AppState {
    pub storage: StorageService,
    pub github: Arc<GitHubClient>,
    pub claude: ClaudeExecutor,
    pub git: Arc<GitService>,
    pub engine: WorkflowEngine,
    pub backlog: BacklogService,
    pub initialization: Arc<RwLock<InitializationState>>,
}

impl AppState {
    pub fn new() -> Self {
        let engine = WorkflowEngine::new();
        let backlog = BacklogService::new(engine.db_pool_handle());
        Self {
            storage: StorageService::new(),
            github: Arc::new(GitHubClient::new()),
            claude: ClaudeExecutor::new(),
            git: Arc::new(GitService::new()),
            backlog,
            engine,
            initialization: Arc::new(RwLock::new(InitializationState::new())),
        }
    }
}
