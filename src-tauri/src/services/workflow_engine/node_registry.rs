use crate::errors::{AppError, Result};
use async_trait::async_trait;
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::{Arc, RwLock};

/// Shared execution context passed between nodes during a workflow run.
/// Nodes read inputs from and write outputs to this context.
///
/// ## Thread Safety
/// This implementation uses `Arc<RwLock<>>` for shared mutable state to enable
/// future parallel execution of nodes within a level. Currently, nodes execute
/// sequentially, but this design allows for parallel execution in the future
/// without API changes.
#[derive(Debug, Clone)]
pub struct ExecutionContext {
    /// Global workflow configuration (repository, owner, etc.)
    #[allow(dead_code)]
    pub config: Value,

    /// Per-node outputs keyed by node ID.
    /// Wrapped in Arc<RwLock<>> to allow safe concurrent access for future parallel execution.
    node_outputs: Arc<RwLock<HashMap<String, Value>>>,

    /// The working directory for the current execution (e.g. repo path).
    /// Wrapped in Arc<RwLock<>> to allow safe concurrent access.
    working_dir: Arc<RwLock<Option<String>>>,
}

#[allow(dead_code)]
impl ExecutionContext {
    pub fn new(config: Value) -> Self {
        Self {
            config,
            node_outputs: Arc::new(RwLock::new(HashMap::new())),
            working_dir: Arc::new(RwLock::new(None)),
        }
    }

    /// Retrieve the output of a previously executed node.
    /// Returns a clone of the output value.
    pub fn get_node_output(&self, node_id: &str) -> Option<Value> {
        self.node_outputs.read().ok()?.get(node_id).cloned()
    }

    /// Store the output of a node.
    /// Thread-safe for concurrent access.
    pub fn set_node_output(&self, node_id: String, output: Value) {
        if let Ok(mut outputs) = self.node_outputs.write() {
            outputs.insert(node_id, output);
        }
    }

    /// Get the current working directory.
    pub fn get_working_dir(&self) -> Option<String> {
        self.working_dir.read().ok()?.clone()
    }

    /// Set the working directory.
    /// Thread-safe for concurrent access.
    pub fn set_working_dir(&self, dir: Option<String>) {
        if let Ok(mut wd) = self.working_dir.write() {
            *wd = dir;
        }
    }

    /// Resolve a value reference like `{{node_id.field}}` from node outputs.
    /// Returns the resolved value or an error if the reference doesn't exist.
    pub fn resolve_reference(&self, reference: &str) -> crate::errors::Result<Value> {
        let trimmed = reference
            .trim_start_matches("{{")
            .trim_end_matches("}}")
            .trim();
        let parts: Vec<&str> = trimmed.splitn(2, '.').collect();

        if parts.is_empty() {
            return Err(crate::errors::types::AppError::TemplateResolution {
                reference: reference.to_string(),
                reason: "Empty reference".to_string(),
            });
        }

        let node_id = parts[0];
        let outputs = self.node_outputs.read().map_err(|_| {
            crate::errors::types::AppError::TemplateResolution {
                reference: reference.to_string(),
                reason: "Failed to acquire read lock on node outputs".to_string(),
            }
        })?;
        let node_output = outputs.get(node_id).ok_or_else(|| {
            crate::errors::types::AppError::TemplateResolution {
                reference: reference.to_string(),
                reason: format!("Node '{}' not found in execution context", node_id),
            }
        })?;

        if parts.len() == 1 {
            return Ok(node_output.clone());
        }

        // Navigate into the JSON value
        let mut current = node_output;
        for key in parts[1].split('.') {
            current = current.get(key).ok_or_else(|| {
                crate::errors::types::AppError::TemplateResolution {
                    reference: reference.to_string(),
                    reason: format!("Field '{}' not found in node output", key),
                }
            })?;
        }

        Ok(current.clone())
    }

    /// Resolve template strings in a JSON value, replacing `{{ref}}` patterns.
    /// This now supports mid-string templates like "path/{{node.id}}/file".
    pub fn resolve_value(&self, value: &Value) -> crate::errors::Result<Value> {
        match value {
            Value::String(s) => {
                // Check if string contains any template patterns
                if !s.contains("{{") {
                    return Ok(value.clone());
                }

                let re = template_regex();

                // Preserve native JSON type when the whole value is exactly one template.
                if let Some(capture) = re.captures(s) {
                    if capture.get(0).map(|m| m.as_str()) == Some(s) {
                        return self.resolve_reference(capture.get(0).unwrap().as_str());
                    }
                }

                let mut result = s.clone();
                let mut errors = Vec::new();

                for cap in re.captures_iter(s) {
                    let full_match = &cap[0]; // Full {{...}} match
                    let reference = &cap[1]; // Content inside {{...}}

                    // Resolve the reference
                    match self.resolve_reference(&format!("{{{{{}}}}}", reference)) {
                        Ok(resolved_value) => {
                            // Convert resolved value to string for replacement
                            let replacement = match &resolved_value {
                                Value::String(s) => s.clone(),
                                Value::Number(n) => n.to_string(),
                                Value::Bool(b) => b.to_string(),
                                Value::Null => "null".to_string(),
                                other => {
                                    serde_json::to_string(other).unwrap_or_else(|_| "".to_string())
                                }
                            };

                            result = result.replace(full_match, &replacement);
                        }
                        Err(e) => {
                            errors.push(e);
                        }
                    }
                }

                // If any resolutions failed, return the first error
                if let Some(err) = errors.into_iter().next() {
                    return Err(err);
                }

                Ok(Value::String(result))
            }
            Value::Object(map) => {
                let mut resolved = serde_json::Map::new();
                for (k, v) in map.iter() {
                    resolved.insert(k.clone(), self.resolve_value(v)?);
                }
                Ok(Value::Object(resolved))
            }
            Value::Array(arr) => {
                let mut resolved = Vec::new();
                for v in arr.iter() {
                    resolved.push(self.resolve_value(v)?);
                }
                Ok(Value::Array(resolved))
            }
            other => Ok(other.clone()),
        }
    }
}

fn template_regex() -> &'static Regex {
    static TEMPLATE_REGEX: OnceLock<Regex> = OnceLock::new();
    TEMPLATE_REGEX.get_or_init(|| Regex::new(r"\{\{([^}]+)\}\}").unwrap())
}

/// The trait every node type must implement.
///
/// ## Thread Safety
/// The `execute` method takes `&ExecutionContext` (not `&mut`) because
/// `ExecutionContext` uses interior mutability (RwLock) for thread-safe access.
/// This design allows future parallel execution of nodes within a level.
#[async_trait]
pub trait NodeExecutor: Send + Sync {
    /// Execute the node with the given configuration and shared context.
    /// Returns the node's output as a JSON value.
    ///
    /// **Note**: `context` is not mutable because it uses interior mutability
    /// for thread-safe access. Use `context.set_node_output()` and
    /// `context.set_working_dir()` to update state.
    async fn execute(
        &self,
        node_id: &str,
        config: &Value,
        context: &ExecutionContext,
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
    pub storage: Arc<crate::services::StorageService>,
    pub claude: Arc<dyn ClaudeRunner>,
    pub git: Arc<crate::services::GitService>,
}

/// Trait for running Claude prompts, enabling mock implementations in tests.
#[async_trait]
pub trait ClaudeRunner: Send + Sync {
    async fn run_prompt(
        &self,
        prompt: &str,
        working_dir: Option<&str>,
        timeout_secs: Option<u64>,
    ) -> Result<String>;
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
}

#[async_trait]
impl ClaudeRunner for ClaudeProvider {
    /// Run a claude prompt and collect the full output.
    async fn run_prompt(
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

#[allow(dead_code)]
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
            .ok_or_else(|| AppError::Validation(format!("Unknown node type: {}", node_type)))
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
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output("node1".into(), serde_json::json!({"result": 42}));
        let output = ctx.get_node_output("node1").unwrap();
        assert_eq!(output["result"], 42);
    }

    #[test]
    fn test_resolve_simple_reference() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output(
            "sync".into(),
            serde_json::json!({"owner": "phmatray", "repo": "test"}),
        );
        let resolved = ctx.resolve_reference("{{sync.owner}}").unwrap();
        assert_eq!(resolved, serde_json::json!("phmatray"));
    }

    #[test]
    fn test_resolve_nested_reference() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
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
        assert!(ctx.resolve_reference("{{missing.field}}").is_err());
    }

    #[test]
    fn test_resolve_value_string_template() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output("sync".into(), serde_json::json!({"repo": "my-repo"}));

        let input = serde_json::json!({"name": "{{sync.repo}}"});
        let resolved = ctx.resolve_value(&input).unwrap();
        assert_eq!(resolved["name"], serde_json::json!("my-repo"));
    }

    #[test]
    fn test_resolve_value_non_template() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        let input = serde_json::json!({"name": "literal"});
        let resolved = ctx.resolve_value(&input).unwrap();
        assert_eq!(resolved["name"], serde_json::json!("literal"));
    }

    #[test]
    fn test_resolve_value_mid_string_template() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output("issue".into(), serde_json::json!({"number": 123}));

        let input = serde_json::json!({"branch": "feature/{{issue.number}}-fix"});
        let resolved = ctx.resolve_value(&input).unwrap();
        assert_eq!(resolved["branch"], serde_json::json!("feature/123-fix"));
    }

    #[test]
    fn test_resolve_value_multiple_templates() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output("user".into(), serde_json::json!({"name": "John"}));
        ctx.set_node_output("repo".into(), serde_json::json!({"name": "test-repo"}));

        let input = serde_json::json!({"path": "/repos/{{user.name}}/{{repo.name}}/issues"});
        let resolved = ctx.resolve_value(&input).unwrap();
        assert_eq!(
            resolved["path"],
            serde_json::json!("/repos/John/test-repo/issues")
        );
    }

    #[test]
    fn test_resolve_value_error_on_missing_reference() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        let input = serde_json::json!({"path": "feature/{{missing.id}}-fix"});
        let result = ctx.resolve_value(&input);
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_value_preserves_array_type_for_full_template() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output(
            "issues".into(),
            serde_json::json!({"items": [{"id": 1}, {"id": 2}]}),
        );

        let input = serde_json::json!({"items": "{{issues.items}}"});
        let resolved = ctx.resolve_value(&input).unwrap();
        assert!(resolved["items"].is_array());
        assert_eq!(resolved["items"][0]["id"], 1);
    }

    #[test]
    fn test_resolve_value_preserves_number_type_for_full_template() {
        let ctx = ExecutionContext::new(Value::Object(Default::default()));
        ctx.set_node_output("stats".into(), serde_json::json!({"count": 42}));

        let input = serde_json::json!({"count": "{{stats.count}}"});
        let resolved = ctx.resolve_value(&input).unwrap();
        assert_eq!(resolved["count"], serde_json::json!(42));
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
