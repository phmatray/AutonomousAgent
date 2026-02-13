use crate::errors::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::RwLock;
use tokio::time::{timeout, Duration};

const DEFAULT_TIMEOUT_SECS: u64 = 600; // 10 minutes

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeOutput {
    pub execution_id: String,
    pub content: String,
    pub stream: String, // "stdout" or "stderr"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeExecutionComplete {
    pub execution_id: String,
    pub exit_code: Option<i32>,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionInfo {
    pub id: String,
    pub status: String,
    pub started_at: String,
}

struct RunningExecution {
    abort_handle: tokio::task::JoinHandle<()>,
}

pub struct ClaudeExecutor {
    running: Arc<RwLock<HashMap<String, RunningExecution>>>,
}

#[allow(dead_code)]
impl ClaudeExecutor {
    pub fn new() -> Self {
        Self {
            running: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn execute(
        &self,
        app: AppHandle,
        execution_id: String,
        prompt: String,
        working_dir: Option<String>,
        timeout_secs: Option<u64>,
    ) -> Result<ExecutionInfo> {
        let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS));

        let exec_id = execution_id.clone();
        let app_clone = app.clone();
        let running = self.running.clone();

        let handle = tokio::spawn(async move {
            let result = Self::run_claude_process(
                app_clone.clone(),
                exec_id.clone(),
                prompt,
                working_dir,
                timeout_duration,
            )
            .await;

            // Clean up from running map
            running.write().await.remove(&exec_id);

            let (exit_code, success) = match result {
                Ok(code) => (Some(code), code == 0),
                Err(_) => (None, false),
            };

            let _ = app_clone.emit(
                "claude:execution:complete",
                ClaudeExecutionComplete {
                    execution_id: exec_id,
                    exit_code,
                    success,
                },
            );
        });

        self.running.write().await.insert(
            execution_id.clone(),
            RunningExecution {
                abort_handle: handle,
            },
        );

        Ok(ExecutionInfo {
            id: execution_id,
            status: "RUNNING".to_string(),
            started_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    async fn run_claude_process(
        app: AppHandle,
        execution_id: String,
        prompt: String,
        working_dir: Option<String>,
        timeout_duration: Duration,
    ) -> Result<i32> {
        let mut cmd = Command::new("claude");
        cmd.arg("--print");
        cmd.arg(&prompt);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
        }

        let mut child = cmd.spawn().map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("Failed to spawn claude CLI: {}. Is 'claude' installed?", e),
            ))
        })?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let exec_id_stdout = execution_id.clone();
        let app_stdout = app.clone();
        let stdout_task = tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stdout.emit(
                    "claude:output:stdout",
                    ClaudeOutput {
                        execution_id: exec_id_stdout.clone(),
                        content: line,
                        stream: "stdout".to_string(),
                    },
                );
            }
        });

        let exec_id_stderr = execution_id.clone();
        let app_stderr = app.clone();
        let stderr_task = tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stderr.emit(
                    "claude:output:stderr",
                    ClaudeOutput {
                        execution_id: exec_id_stderr.clone(),
                        content: line,
                        stream: "stderr".to_string(),
                    },
                );
            }
        });

        let result = timeout(timeout_duration, child.wait()).await;

        // Wait for stream readers to finish
        let _ = stdout_task.await;
        let _ = stderr_task.await;

        match result {
            Ok(Ok(status)) => Ok(status.code().unwrap_or(-1)),
            Ok(Err(e)) => Err(AppError::Io(e)),
            Err(_) => {
                // Timeout - kill the process
                let _ = child.kill().await;
                Err(AppError::Timeout)
            }
        }
    }

    pub async fn cancel(&self, execution_id: &str) -> Result<()> {
        let mut running = self.running.write().await;
        if let Some(execution) = running.remove(execution_id) {
            execution.abort_handle.abort();
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "No running execution with id: {}",
                execution_id
            )))
        }
    }

    pub async fn is_running(&self, execution_id: &str) -> bool {
        self.running.read().await.contains_key(execution_id)
    }

    pub async fn list_running(&self) -> Vec<String> {
        self.running.read().await.keys().cloned().collect()
    }
}
