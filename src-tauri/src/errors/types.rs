use serde::{Serialize, Serializer};
use thiserror::Error;

/// Error codes for categorizing errors
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    // Database errors (DB-001 to DB-099)
    DatabaseConnection,
    DatabaseQuery,
    DatabaseMigration,
    DatabaseNotInitialized,

    // GitHub errors (GH-001 to GH-099)
    GitHubApi,
    GitHubAuthentication,
    GitHubRateLimit,
    GitHubNotFound,

    // Git errors (GT-001 to GT-099)
    GitLibrary,
    GitCli,
    GitWorktree,
    GitBranch,

    // Workflow errors (WF-001 to WF-099)
    WorkflowValidation,
    WorkflowExecution,
    WorkflowCycle,
    TemplateResolution,

    // General errors (GN-001 to GN-099)
    Network,
    Timeout,
    Authentication,
    Validation,
    Io,
    Serialization,
    Keyring,
    Tauri,
    Unknown,
}

impl ErrorCode {
    /// Get the string representation of the error code
    pub fn as_str(&self) -> &'static str {
        match self {
            // Database
            ErrorCode::DatabaseConnection => "DB-001",
            ErrorCode::DatabaseQuery => "DB-002",
            ErrorCode::DatabaseMigration => "DB-003",
            ErrorCode::DatabaseNotInitialized => "DB-004",

            // GitHub
            ErrorCode::GitHubApi => "GH-001",
            ErrorCode::GitHubAuthentication => "GH-002",
            ErrorCode::GitHubRateLimit => "GH-003",
            ErrorCode::GitHubNotFound => "GH-004",

            // Git
            ErrorCode::GitLibrary => "GT-001",
            ErrorCode::GitCli => "GT-002",
            ErrorCode::GitWorktree => "GT-003",
            ErrorCode::GitBranch => "GT-004",

            // Workflow
            ErrorCode::WorkflowValidation => "WF-001",
            ErrorCode::WorkflowExecution => "WF-002",
            ErrorCode::WorkflowCycle => "WF-003",
            ErrorCode::TemplateResolution => "WF-004",

            // General
            ErrorCode::Network => "GN-001",
            ErrorCode::Timeout => "GN-002",
            ErrorCode::Authentication => "GN-003",
            ErrorCode::Validation => "GN-004",
            ErrorCode::Io => "GN-005",
            ErrorCode::Serialization => "GN-006",
            ErrorCode::Keyring => "GN-007",
            ErrorCode::Tauri => "GN-008",
            ErrorCode::Unknown => "GN-099",
        }
    }
}

#[derive(Error, Debug)]
#[allow(dead_code)]
pub enum AppError {
    #[error("[{code}] Database error: {message}")]
    Database { code: &'static str, message: String },

    #[error("[GH-001] GitHub API error: {0}")]
    GitHub(String),

    #[error("[GH-002] GitHub authentication failed: {0}")]
    GitHubAuth(String),

    #[error("[GH-003] GitHub rate limit exceeded")]
    GitHubRateLimit,

    #[error("[GH-004] GitHub resource not found: {0}")]
    GitHubNotFound(String),

    #[error("[GT-001] Git error: {0}")]
    Git(#[from] git2::Error),

    #[error("[GT-002] Git CLI error: {0}")]
    GitCli(String),

    #[error("[GT-003] Git worktree error: {0}")]
    GitWorktree(String),

    #[error("[GT-004] Git branch error: {0}")]
    GitBranch(String),

    #[error("[GN-001] Network error: {0}")]
    Network(String),

    #[error("[GN-002] Operation timed out")]
    Timeout,

    #[error("[GN-003] Authentication failed: {0}")]
    Authentication(String),

    #[error("[GN-004] Validation error: {0}")]
    Validation(String),

    #[error("[WF-001] Workflow validation error: {0}")]
    WorkflowValidation(String),

    #[error("[WF-002] Workflow execution error: {0}")]
    WorkflowExecution(String),

    #[error("[WF-003] Workflow contains cycles: {0}")]
    WorkflowCycle(String),

    #[error("[WF-004] Template resolution failed for '{reference}': {reason}")]
    TemplateResolution { reference: String, reason: String },

    #[error("[GN-005] IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("[GN-006] Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("[GN-007] Keyring error: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("[GN-008] Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("[GN-099] Unknown error: {0}")]
    Unknown(String),
}

/// Structured error response for frontend
#[derive(Serialize, Debug)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    /// Get the error code for this error
    pub fn code(&self) -> ErrorCode {
        match self {
            AppError::Database { .. } => ErrorCode::DatabaseQuery,
            AppError::GitHub(_) => ErrorCode::GitHubApi,
            AppError::GitHubAuth(_) => ErrorCode::GitHubAuthentication,
            AppError::GitHubRateLimit => ErrorCode::GitHubRateLimit,
            AppError::GitHubNotFound(_) => ErrorCode::GitHubNotFound,
            AppError::Git(_) => ErrorCode::GitLibrary,
            AppError::GitCli(_) => ErrorCode::GitCli,
            AppError::GitWorktree(_) => ErrorCode::GitWorktree,
            AppError::GitBranch(_) => ErrorCode::GitBranch,
            AppError::Network(_) => ErrorCode::Network,
            AppError::Timeout => ErrorCode::Timeout,
            AppError::Authentication(_) => ErrorCode::Authentication,
            AppError::Validation(_) => ErrorCode::Validation,
            AppError::WorkflowValidation(_) => ErrorCode::WorkflowValidation,
            AppError::WorkflowExecution(_) => ErrorCode::WorkflowExecution,
            AppError::WorkflowCycle(_) => ErrorCode::WorkflowCycle,
            AppError::TemplateResolution { .. } => ErrorCode::TemplateResolution,
            AppError::Io(_) => ErrorCode::Io,
            AppError::Serialization(_) => ErrorCode::Serialization,
            AppError::Keyring(_) => ErrorCode::Keyring,
            AppError::Tauri(_) => ErrorCode::Tauri,
            AppError::Unknown(_) => ErrorCode::Unknown,
        }
    }

    /// Convert to structured error response
    pub fn to_response(&self) -> ErrorResponse {
        ErrorResponse {
            code: self.code().as_str().to_string(),
            message: self.to_string(),
            details: None,
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.to_response().serialize(serializer)
    }
}

/// Helper to convert sqlx errors to AppError with appropriate codes
impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        let code = match &err {
            sqlx::Error::PoolTimedOut => ErrorCode::DatabaseConnection.as_str(),
            sqlx::Error::PoolClosed => ErrorCode::DatabaseConnection.as_str(),
            sqlx::Error::Migrate(_) => ErrorCode::DatabaseMigration.as_str(),
            _ => ErrorCode::DatabaseQuery.as_str(),
        };

        AppError::Database {
            code,
            message: err.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
