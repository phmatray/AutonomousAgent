pub mod storage;
pub mod github_client;
pub mod claude_executor;
pub mod git_service;
pub mod workflow_engine;

pub use storage::StorageService;
pub use github_client::GitHubClient;
pub use claude_executor::ClaudeExecutor;
pub use git_service::GitService;
pub use workflow_engine::WorkflowEngine;

/// Application state containing all services, shared via Tauri's managed state.
pub struct AppState {
    pub storage: StorageService,
    pub github: GitHubClient,
    pub claude: ClaudeExecutor,
    pub git: GitService,
    pub engine: WorkflowEngine,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            storage: StorageService::new(),
            github: GitHubClient::new(),
            claude: ClaudeExecutor::new(),
            git: GitService::new(),
            engine: WorkflowEngine::new(),
        }
    }
}
