use crate::errors::{AppError, Result};
use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

/// Shared execution context passed between nodes during a workflow run.
/// Nodes read inputs from and write outputs to this context.
#[derive(Debug, Clone)]
pub struct ExecutionContext {
    /// Global workflow configuration (repository, owner, etc.)
    pub config: Value,
    /// Per-node outputs keyed by node ID.
    pub node_outputs: HashMap<String, Value>,
    /// The working directory for the current execution (e.g. repo path).
    pub working_dir: Option<String>,
}

impl ExecutionContext {
    pub fn new(config: Value) -> Self {
        Self {
            config,
            node_outputs: HashMap::new(),
            working_dir: None,
        }
    }

    /// Retrieve the output of a previously executed node.
    pub fn get_node_output(&self, node_id: &str) -> Option<&Value> {
        self.node_outputs.get(node_id)
    }

    /// Store the output of a node.
    pub fn set_node_output(&mut self, node_id: String, output: Value) {
        self.node_outputs.insert(node_id, output);
    }

    /// Resolve a value reference like `{{node_id.field}}` from node outputs.
    pub fn resolve_reference(&self, reference: &str) -> Option<Value> {
        let trimmed = reference.trim_start_matches("{{").trim_end_matches("}}").trim();
        let parts: Vec<&str> = trimmed.splitn(2, '.').collect();
        if parts.is_empty() {
            return None;
        }
        let node_output = self.node_outputs.get(parts[0])?;
        if parts.len() == 1 {
            return Some(node_output.clone());
        }
        // Navigate into the JSON value
        let mut current = node_output;
        for key in parts[1].split('.') {
            current = current.get(key)?;
        }
        Some(current.clone())
    }

    /// Resolve template strings in a JSON value, replacing `{{ref}}` patterns.
    pub fn resolve_value(&self, value: &Value) -> Value {
        match value {
            Value::String(s) => {
                if s.starts_with("{{") && s.ends_with("}}") {
                    self.resolve_reference(s).unwrap_or_else(|| value.clone())
                } else {
                    value.clone()
                }
            }
            Value::Object(map) => {
                let resolved: serde_json::Map<String, Value> = map
                    .iter()
                    .map(|(k, v)| (k.clone(), self.resolve_value(v)))
                    .collect();
                Value::Object(resolved)
            }
            Value::Array(arr) => {
                let resolved: Vec<Value> = arr.iter().map(|v| self.resolve_value(v)).collect();
                Value::Array(resolved)
            }
            other => other.clone(),
        }
    }
}

/// The trait every node type must implement.
#[async_trait]
pub trait NodeExecutor: Send + Sync {
    /// Execute the node with the given configuration and shared context.
    /// Returns the node's output as a JSON value.
    async fn execute(
        &self,
        node_id: &str,
        config: &Value,
        context: &mut ExecutionContext,
        services: &ServiceProvider,
    ) -> Result<Value>;

    /// Validate node configuration before execution.
    fn validate(&self, config: &Value) -> Result<()> {
        let _ = config;
        Ok(())
    }

    /// Return the node type identifier (e.g. "github.sync").
    fn node_type(&self) -> &'static str;
}

/// Provides access to application services for node executors.
/// This wraps the services so node executors don't depend on Tauri state directly.
pub struct ServiceProvider {
    pub github: Arc<crate::services::GitHubClient>,
    pub claude: Arc<ClaudeProvider>,
    pub git: Arc<crate::services::GitService>,
}

/// Wraps ClaudeExecutor to run prompts without requiring AppHandle per call.
/// Collects output synchronously instead of streaming via Tauri events.
pub struct ClaudeProvider {
    _inner: (),
}

impl ClaudeProvider {
    pub fn new() -> Self {
        Self { _inner: () }
    }

    /// Run a claude prompt and collect the full output.
    pub async fn run_prompt(
        &self,
        prompt: &str,
        working_dir: Option<&str>,
        timeout_secs: Option<u64>,
    ) -> Result<String> {
        use tokio::process::Command;
        use tokio::time::{timeout, Duration};

        let timeout_duration = Duration::from_secs(timeout_secs.unwrap_or(600));

        let mut cmd = Command::new("claude");
        cmd.arg("--print");
        cmd.arg(prompt);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        if let Some(dir) = working_dir {
            cmd.current_dir(dir);
        }

        let child = cmd.spawn().map_err(|e| {
            AppError::Io(std::io::Error::new(
                e.kind(),
                format!("Failed to spawn claude CLI: {}. Is 'claude' installed?", e),
            ))
        })?;

        let result = timeout(timeout_duration, child.wait_with_output()).await;

        match result {
            Ok(Ok(output)) => {
                if output.status.success() {
                    Ok(String::from_utf8_lossy(&output.stdout).to_string())
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Err(AppError::Unknown(format!("Claude CLI failed: {}", stderr)))
                }
            }
            Ok(Err(e)) => Err(AppError::Io(e)),
            Err(_) => Err(AppError::Timeout),
        }
    }
}

/// Registry that maps node type strings to their executor implementations.
pub struct NodeRegistry {
    executors: HashMap<String, Box<dyn NodeExecutor>>,
}

impl NodeRegistry {
    pub fn new() -> Self {
        Self {
            executors: HashMap::new(),
        }
    }

    pub fn register<E: NodeExecutor + 'static>(&mut self, executor: E) {
        self.executors
            .insert(executor.node_type().to_string(), Box::new(executor));
    }

    pub fn get(&self, node_type: &str) -> Result<&dyn NodeExecutor> {
        self.executors
            .get(node_type)
            .map(|e| e.as_ref())
            .ok_or_else(|| {
                AppError::Validation(format!("Unknown node type: {}", node_type))
            })
    }

    pub fn has(&self, node_type: &str) -> bool {
        self.executors.contains_key(node_type)
    }

    pub fn registered_types(&self) -> Vec<&str> {
        self.executors.keys().map(|k| k.as_str()).collect()
    }
}

/// Build a fully-populated registry with all built-in node types.
pub fn build_default_registry() -> NodeRegistry {
    use super::nodes::{claude, control, git, github};

    let mut registry = NodeRegistry::new();

    // GitHub nodes
    registry.register(github::GithubSyncNode);
    registry.register(github::GithubReadIssuesNode);
    registry.register(github::GithubCreatePrNode);

    // Git nodes
    registry.register(git::GitWorktreeNode);
    registry.register(git::GitBranchNode);
    registry.register(git::GitCommitNode);

    // Claude nodes
    registry.register(claude::ClaudePlanNode);
    registry.register(claude::ClaudeApplyNode);
    registry.register(claude::ClaudeAnalyzeNode);

    // Control flow nodes
    registry.register(control::TriggerNode);
    registry.register(control::ConditionNode);
    registry.register(control::LoopNode);
    registry.register(control::DelayNode);

    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_execution_context_set_and_get() {
        let mut ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output("node1".into(), serde_json::json!({"result": 42}));
        let output = ctx.get_node_output("node1").unwrap();
        assert_eq!(output["result"], 42);
    }

    #[test]
    fn test_resolve_simple_reference() {
        let mut ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output(
            "sync".into(),
            serde_json::json!({"owner": "phmatray", "repo": "test"}),
        );
        let resolved = ctx.resolve_reference("{{sync.owner}}").unwrap();
        assert_eq!(resolved, serde_json::json!("phmatray"));
    }

    #[test]
    fn test_resolve_nested_reference() {
        let mut ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output(
            "data".into(),
            serde_json::json!({"nested": {"deep": "value"}}),
        );
        let resolved = ctx.resolve_reference("{{data.nested.deep}}").unwrap();
        assert_eq!(resolved, serde_json::json!("value"));
    }

    #[test]
    fn test_resolve_reference_missing() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        assert!(ctx.resolve_reference("{{missing.field}}").is_none());
    }

    #[test]
    fn test_resolve_value_string_template() {
        let mut ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output("sync".into(), serde_json::json!({"repo": "my-repo"}));

        let input = serde_json::json!({"name": "{{sync.repo}}"});
        let resolved = ctx.resolve_value(&input);
        assert_eq!(resolved["name"], serde_json::json!("my-repo"));
    }

    #[test]
    fn test_resolve_value_non_template() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        let input = serde_json::json!({"name": "literal"});
        let resolved = ctx.resolve_value(&input);
        assert_eq!(resolved["name"], serde_json::json!("literal"));
    }

    #[test]
    fn test_registry_has_all_node_types() {
        let registry = build_default_registry();
        let expected = vec![
            "trigger",
            "condition",
            "loop",
            "delay",
            "github.sync",
            "github.readIssues",
            "github.createPR",
            "git.worktree",
            "git.branch",
            "git.commit",
            "claude.plan",
            "claude.apply",
            "claude.analyze",
        ];
        for node_type in expected {
            assert!(
                registry.has(node_type),
                "Registry missing node type: {}",
                node_type
            );
        }
    }

    #[test]
    fn test_registry_get_unknown_type() {
        let registry = build_default_registry();
        assert!(registry.get("nonexistent").is_err());
    }
}
