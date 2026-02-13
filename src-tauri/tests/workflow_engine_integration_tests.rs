/// Workflow engine integration tests.
///
/// These tests exercise the DAG execution logic, template resolution pipeline,
/// condition branching, cycle detection, error propagation, retry behavior,
/// and concurrent execution. They are self-contained and use mock services
/// to avoid external dependencies (GitHub API, git CLI, Claude CLI).
///
/// Run with: cd src-tauri && cargo test workflow_engine_integration
use async_trait::async_trait;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, RwLock};

// ===========================================================================
// Inline model types (mirror the crate's internal types)
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Workflow {
    id: String,
    name: String,
    description: Option<String>,
    nodes: Vec<WorkflowNode>,
    edges: Vec<WorkflowEdge>,
    config: Option<Value>,
    version: i32,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkflowNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    config: Option<Value>,
    inputs: Option<Value>,
    position: Option<NodePosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NodePosition {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkflowEdge {
    id: String,
    source: String,
    target: String,
    source_handle: Option<String>,
    target_handle: Option<String>,
}

// ===========================================================================
// Execution context (mirrors the crate's ExecutionContext)
// ===========================================================================

#[derive(Debug, Clone)]
struct ExecutionContext {
    #[allow(dead_code)]
    config: Value,
    node_outputs: Arc<RwLock<HashMap<String, Value>>>,
    working_dir: Arc<RwLock<Option<String>>>,
}

impl ExecutionContext {
    fn new(config: Value) -> Self {
        Self {
            config,
            node_outputs: Arc::new(RwLock::new(HashMap::new())),
            working_dir: Arc::new(RwLock::new(None)),
        }
    }

    fn get_node_output(&self, node_id: &str) -> Option<Value> {
        self.node_outputs.read().ok()?.get(node_id).cloned()
    }

    fn set_node_output(&self, node_id: String, output: Value) {
        if let Ok(mut outputs) = self.node_outputs.write() {
            outputs.insert(node_id, output);
        }
    }

    fn get_working_dir(&self) -> Option<String> {
        self.working_dir.read().ok()?.clone()
    }

    fn set_working_dir(&self, dir: Option<String>) {
        if let Ok(mut wd) = self.working_dir.write() {
            *wd = dir;
        }
    }

    fn resolve_reference(&self, reference: &str) -> Result<Value, String> {
        let trimmed = reference
            .trim_start_matches("{{")
            .trim_end_matches("}}")
            .trim();
        let parts: Vec<&str> = trimmed.splitn(2, '.').collect();

        if parts.is_empty() {
            return Err(format!("Empty reference: {}", reference));
        }

        let node_id = parts[0];
        let outputs = self
            .node_outputs
            .read()
            .map_err(|_| "Lock poisoned".to_string())?;
        let node_output = outputs
            .get(node_id)
            .ok_or_else(|| format!("Node '{}' not found in context", node_id))?;

        if parts.len() == 1 {
            return Ok(node_output.clone());
        }

        let mut current = node_output;
        for key in parts[1].split('.') {
            // Try array index first, then object key
            current = if let Ok(index) = key.parse::<usize>() {
                current.get(index)
            } else {
                current.get(key)
            }
            .ok_or_else(|| format!("Field '{}' not found in node output", key))?;
        }

        Ok(current.clone())
    }

    fn resolve_value(&self, value: &Value) -> Result<Value, String> {
        match value {
            Value::String(s) => {
                if !s.contains("{{") {
                    return Ok(value.clone());
                }

                let re = regex::Regex::new(r"\{\{([^}]+)\}\}").unwrap();
                let mut result = s.clone();

                for cap in re.captures_iter(s) {
                    let full_match = &cap[0];
                    let reference = &cap[1];

                    let resolved = self.resolve_reference(&format!("{{{{{}}}}}", reference))?;
                    let replacement = match &resolved {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => b.to_string(),
                        Value::Null => "null".to_string(),
                        other => serde_json::to_string(other).unwrap_or_default(),
                    };

                    result = result.replace(full_match, &replacement);
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

// ===========================================================================
// Node executor trait + mock implementations
// ===========================================================================

#[async_trait]
trait NodeExecutor: Send + Sync {
    async fn execute(
        &self,
        node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String>;

    fn validate(&self, config: &Value) -> Result<(), String> {
        let _ = config;
        Ok(())
    }

    fn node_type(&self) -> &'static str;
}

struct NodeRegistry {
    executors: HashMap<String, Box<dyn NodeExecutor>>,
}

impl NodeRegistry {
    fn new() -> Self {
        Self {
            executors: HashMap::new(),
        }
    }

    fn register<E: NodeExecutor + 'static>(&mut self, executor: E) {
        self.executors
            .insert(executor.node_type().to_string(), Box::new(executor));
    }

    fn get(&self, node_type: &str) -> Result<&dyn NodeExecutor, String> {
        self.executors
            .get(node_type)
            .map(|e| e.as_ref())
            .ok_or_else(|| format!("Unknown node type: {}", node_type))
    }

    fn has(&self, node_type: &str) -> bool {
        self.executors.contains_key(node_type)
    }
}

// ===========================================================================
// DAG builder (mirrors crate's build_dag + execute_workflow)
// ===========================================================================

#[derive(Debug)]
struct DagInfo {
    adjacency: HashMap<String, Vec<String>>,
    #[allow(dead_code)]
    in_degree: HashMap<String, usize>,
    nodes: HashMap<String, WorkflowNode>,
    levels: Vec<Vec<String>>,
}

fn build_dag(nodes: &[WorkflowNode], edges: &[WorkflowEdge]) -> Result<DagInfo, String> {
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let node_map: HashMap<String, WorkflowNode> =
        nodes.iter().map(|n| (n.id.clone(), n.clone())).collect();

    for node in nodes {
        adjacency.entry(node.id.clone()).or_default();
        in_degree.entry(node.id.clone()).or_insert(0);
    }

    for edge in edges {
        if !node_map.contains_key(&edge.source) {
            return Err(format!(
                "Edge references unknown source node: {}",
                edge.source
            ));
        }
        if !node_map.contains_key(&edge.target) {
            return Err(format!(
                "Edge references unknown target node: {}",
                edge.target
            ));
        }

        adjacency
            .entry(edge.source.clone())
            .or_default()
            .push(edge.target.clone());
        *in_degree.entry(edge.target.clone()).or_insert(0) += 1;
    }

    // Topological sort (Kahn's algorithm)
    let mut queue: VecDeque<String> = VecDeque::new();
    let mut remaining = in_degree.clone();

    for (node_id, &deg) in &remaining {
        if deg == 0 {
            queue.push_back(node_id.clone());
        }
    }

    let mut levels: Vec<Vec<String>> = Vec::new();
    let mut visited_count = 0;

    while !queue.is_empty() {
        let level_size = queue.len();
        let mut current_level = Vec::new();

        for _ in 0..level_size {
            let node_id = queue.pop_front().unwrap();
            current_level.push(node_id.clone());
            visited_count += 1;

            if let Some(successors) = adjacency.get(&node_id) {
                for succ in successors {
                    let deg = remaining.get_mut(succ).unwrap();
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push_back(succ.clone());
                    }
                }
            }
        }

        levels.push(current_level);
    }

    if visited_count != nodes.len() {
        return Err("Workflow DAG contains a cycle".to_string());
    }

    Ok(DagInfo {
        adjacency,
        in_degree,
        nodes: node_map,
        levels,
    })
}

fn mark_subtree_skipped(
    node_id: &str,
    adjacency: &HashMap<String, Vec<String>>,
    skipped: &mut HashSet<String>,
) {
    if skipped.contains(node_id) {
        return;
    }
    skipped.insert(node_id.to_string());
    if let Some(successors) = adjacency.get(node_id) {
        for succ in successors {
            mark_subtree_skipped(succ, adjacency, skipped);
        }
    }
}

// ===========================================================================
// Execution result types
// ===========================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct NodeExecutionResult {
    node_id: String,
    status: String,
    output: Option<Value>,
    error: Option<String>,
    retry_count: u32,
}

#[derive(Debug, Clone)]
struct RetryPolicy {
    max_retries: u32,
    retry_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 2,
            retry_delay_ms: 1000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WorkflowExecutionResult {
    execution_id: String,
    workflow_id: String,
    status: String,
    node_results: Vec<NodeExecutionResult>,
    error: Option<String>,
}

// ===========================================================================
// Workflow executor (mirrors crate's execute_workflow)
// ===========================================================================

async fn execute_workflow(
    execution_id: &str,
    workflow: &Workflow,
    registry: &NodeRegistry,
    retry_policy: &RetryPolicy,
) -> WorkflowExecutionResult {
    let mut node_results: Vec<NodeExecutionResult> = Vec::new();

    // Build DAG
    let dag = match build_dag(&workflow.nodes, &workflow.edges) {
        Ok(d) => d,
        Err(e) => {
            return WorkflowExecutionResult {
                execution_id: execution_id.to_string(),
                workflow_id: workflow.id.clone(),
                status: "FAILED".to_string(),
                node_results,
                error: Some(format!("DAG validation failed: {}", e)),
            };
        }
    };

    // Validate all node types exist
    for node in &workflow.nodes {
        if !registry.has(&node.node_type) {
            return WorkflowExecutionResult {
                execution_id: execution_id.to_string(),
                workflow_id: workflow.id.clone(),
                status: "FAILED".to_string(),
                node_results,
                error: Some(format!("Unknown node type: {}", node.node_type)),
            };
        }
    }

    let context = ExecutionContext::new(
        workflow
            .config
            .clone()
            .unwrap_or(Value::Object(Default::default())),
    );

    let mut skipped_nodes: HashSet<String> = HashSet::new();
    let mut failed = false;
    let mut workflow_error: Option<String> = None;

    for level in &dag.levels {
        if failed {
            for node_id in level {
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: "SKIPPED".to_string(),
                    output: None,
                    error: Some("Skipped due to prior failure".into()),
                    retry_count: 0,
                });
            }
            continue;
        }

        for node_id in level {
            if skipped_nodes.contains(node_id) {
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: "SKIPPED".to_string(),
                    output: None,
                    error: None,
                    retry_count: 0,
                });
                continue;
            }

            let node = &dag.nodes[node_id];
            let executor = match registry.get(&node.node_type) {
                Ok(e) => e,
                Err(e) => {
                    failed = true;
                    workflow_error = Some(format!("Node {}: {}", node_id, e));
                    node_results.push(NodeExecutionResult {
                        node_id: node_id.clone(),
                        status: "FAILED".to_string(),
                        output: None,
                        error: workflow_error.clone(),
                        retry_count: 0,
                    });
                    break;
                }
            };

            let config = node
                .config
                .clone()
                .unwrap_or(Value::Object(Default::default()));

            // Validate
            if let Err(e) = executor.validate(&config) {
                failed = true;
                workflow_error = Some(format!("Node {} validation failed: {}", node_id, e));
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: "FAILED".to_string(),
                    output: None,
                    error: workflow_error.clone(),
                    retry_count: 0,
                });
                break;
            }

            // Execute with retries
            let mut last_error = None;
            let mut retry_count = 0u32;
            let mut node_output = None;

            for attempt in 0..=retry_policy.max_retries {
                retry_count = attempt;

                match executor.execute(node_id, &config, &context).await {
                    Ok(output) => {
                        node_output = Some(output);
                        last_error = None;
                        break;
                    }
                    Err(e) => {
                        last_error = Some(e);
                        if attempt < retry_policy.max_retries {
                            tokio::time::sleep(tokio::time::Duration::from_millis(
                                retry_policy.retry_delay_ms,
                            ))
                            .await;
                        }
                    }
                }
            }

            if let Some(output) = node_output {
                context.set_node_output(node_id.clone(), output.clone());

                // Handle condition branching
                if node.node_type == "condition" {
                    let branch = output["branch"].as_str().unwrap_or("true");
                    if let Some(successors) = dag.adjacency.get(node_id) {
                        for succ_id in successors {
                            let edge = workflow
                                .edges
                                .iter()
                                .find(|e| &e.source == node_id && &e.target == succ_id);
                            if let Some(edge) = edge {
                                let handle = edge.source_handle.as_deref().unwrap_or("true");
                                if handle != branch {
                                    mark_subtree_skipped(
                                        succ_id,
                                        &dag.adjacency,
                                        &mut skipped_nodes,
                                    );
                                }
                            }
                        }
                    }
                }

                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: "COMPLETED".to_string(),
                    output: Some(output),
                    error: None,
                    retry_count,
                });
            } else {
                failed = true;
                workflow_error = Some(format!(
                    "Node {} failed after {} retries: {}",
                    node_id,
                    retry_count,
                    last_error.as_deref().unwrap_or("unknown error")
                ));
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: "FAILED".to_string(),
                    output: None,
                    error: last_error,
                    retry_count,
                });
            }
        }
    }

    let final_status = if failed { "FAILED" } else { "COMPLETED" };

    WorkflowExecutionResult {
        execution_id: execution_id.to_string(),
        workflow_id: workflow.id.clone(),
        status: final_status.to_string(),
        node_results,
        error: workflow_error,
    }
}

// ===========================================================================
// Mock node executors
// ===========================================================================

/// Trigger node - always succeeds, returns trigger metadata.
struct MockTriggerNode;

#[async_trait]
impl NodeExecutor for MockTriggerNode {
    fn node_type(&self) -> &'static str {
        "trigger"
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        _context: &ExecutionContext,
    ) -> Result<Value, String> {
        let trigger_type = config["trigger_type"].as_str().unwrap_or("manual");
        Ok(json!({
            "triggered_at": Utc::now().to_rfc3339(),
            "trigger_type": trigger_type,
        }))
    }
}

/// Mock GitHub sync - simulates cloning a repo by setting working_dir.
struct MockGithubSyncNode;

#[async_trait]
impl NodeExecutor for MockGithubSyncNode {
    fn node_type(&self) -> &'static str {
        "github.sync"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        for field in &["owner", "repo", "path"] {
            if config.get(field).and_then(|v| v.as_str()).is_none() {
                return Err(format!("github.sync requires '{}' in config", field));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let owner = config["owner"].as_str().unwrap_or("unknown");
        let repo = config["repo"].as_str().unwrap_or("unknown");
        let path = config["path"].as_str().unwrap_or("/tmp");
        let repo_path = format!("{}/{}", path, repo);

        context.set_working_dir(Some(repo_path.clone()));

        Ok(json!({
            "repo_path": repo_path,
            "owner": owner,
            "repo": repo,
        }))
    }
}

/// Mock GitHub readIssues - returns fixed issue data with template resolution.
struct MockGithubReadIssuesNode;

#[async_trait]
impl NodeExecutor for MockGithubReadIssuesNode {
    fn node_type(&self) -> &'static str {
        "github.readIssues"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        for field in &["owner", "repo"] {
            if config.get(field).is_none() {
                return Err(format!("github.readIssues requires '{}' in config", field));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let _owner = resolved["owner"].as_str().ok_or("owner must be a string")?;
        let _repo = resolved["repo"].as_str().ok_or("repo must be a string")?;

        Ok(json!({
            "issues": [
                {
                    "number": 42,
                    "title": "Fix login bug",
                    "body": "The login page crashes on Safari",
                    "state": "open",
                    "labels": ["bug", "priority-high"],
                    "assignees": []
                }
            ],
            "count": 1,
        }))
    }
}

/// Mock git branch node - creates a gitflow branch name.
struct MockGitBranchNode;

#[async_trait]
impl NodeExecutor for MockGitBranchNode {
    fn node_type(&self) -> &'static str {
        "git.branch"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        if config.get("name").is_none() {
            return Err("git.branch requires 'name' in config".to_string());
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let branch_type = resolved["branch_type"].as_str().unwrap_or("feature");
        let name = resolved["name"].as_str().unwrap_or_default();

        let sanitized = name
            .to_lowercase()
            .replace(' ', "-")
            .replace(|c: char| !c.is_alphanumeric() && c != '-', "");
        let branch_name = format!("{}/{}", branch_type, sanitized);

        Ok(json!({
            "branch_name": branch_name,
        }))
    }
}

/// Mock git commit node.
struct MockGitCommitNode;

#[async_trait]
impl NodeExecutor for MockGitCommitNode {
    fn node_type(&self) -> &'static str {
        "git.commit"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        for field in &["commit_type", "description"] {
            if config.get(field).is_none() {
                return Err(format!("git.commit requires '{}' in config", field));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let commit_type = resolved["commit_type"].as_str().unwrap_or("feat");
        let description = resolved["description"].as_str().unwrap_or_default();
        let scope = resolved["scope"].as_str();

        let scope_part = scope.map(|s| format!("({})", s)).unwrap_or_default();
        let message = format!("{}{}: {}", commit_type, scope_part, description);

        Ok(json!({
            "sha": "abc123def456",
            "message": message,
        }))
    }
}

/// Mock Claude plan node.
struct MockClaudePlanNode;

#[async_trait]
impl NodeExecutor for MockClaudePlanNode {
    fn node_type(&self) -> &'static str {
        "claude.plan"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        if config.get("prompt").is_none() {
            return Err("claude.plan requires 'prompt' in config".to_string());
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let prompt = resolved["prompt"]
            .as_str()
            .ok_or("prompt must be a string")?;

        Ok(json!({
            "plan": format!("Plan for: {}", prompt),
        }))
    }
}

/// Mock Claude apply node.
struct MockClaudeApplyNode;

#[async_trait]
impl NodeExecutor for MockClaudeApplyNode {
    fn node_type(&self) -> &'static str {
        "claude.apply"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        if config.get("prompt").is_none() {
            return Err("claude.apply requires 'prompt' in config".to_string());
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let _prompt = resolved["prompt"]
            .as_str()
            .ok_or("prompt must be a string")?;

        Ok(json!({
            "output": "Changes applied successfully",
            "success": true,
        }))
    }
}

/// Mock GitHub create PR node.
struct MockGithubCreatePrNode;

#[async_trait]
impl NodeExecutor for MockGithubCreatePrNode {
    fn node_type(&self) -> &'static str {
        "github.createPR"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        for field in &["owner", "repo", "title", "head"] {
            if config.get(field).is_none() {
                return Err(format!("github.createPR requires '{}' in config", field));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let title = resolved["title"].as_str().unwrap_or("PR");
        let head = resolved["head"].as_str().unwrap_or("main");

        Ok(json!({
            "number": 101,
            "html_url": format!("https://github.com/test/repo/pull/101"),
            "title": title,
            "head": head,
        }))
    }
}

/// Mock condition node.
struct MockConditionNode;

#[async_trait]
impl NodeExecutor for MockConditionNode {
    fn node_type(&self) -> &'static str {
        "condition"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        if config.get("condition").is_none() {
            return Err("condition node requires 'condition' in config".to_string());
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let condition_val = &resolved["condition"];
        let operator = resolved["operator"].as_str().unwrap_or("not_empty");
        let compare_val = &resolved["value"];

        let result = match operator {
            "exists" => !condition_val.is_null(),
            "not_empty" => match condition_val {
                Value::Null => false,
                Value::String(s) => !s.is_empty(),
                Value::Array(a) => !a.is_empty(),
                Value::Object(o) => !o.is_empty(),
                Value::Number(n) => n.as_f64().map(|v| v != 0.0).unwrap_or(false),
                Value::Bool(b) => *b,
            },
            "eq" => condition_val == compare_val,
            "neq" => condition_val != compare_val,
            "gt" => {
                let a = condition_val.as_f64().unwrap_or(0.0);
                let b = compare_val.as_f64().unwrap_or(0.0);
                a > b
            }
            _ => false,
        };

        Ok(json!({
            "result": result,
            "branch": if result { "true" } else { "false" },
        }))
    }
}

/// Mock delay node - uses tiny sleep for testing.
struct MockDelayNode;

#[async_trait]
impl NodeExecutor for MockDelayNode {
    fn node_type(&self) -> &'static str {
        "delay"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        if config.get("seconds").and_then(|v| v.as_u64()).is_none() {
            return Err("delay node requires 'seconds' (integer) in config".to_string());
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        _context: &ExecutionContext,
    ) -> Result<Value, String> {
        // Use milliseconds instead of seconds for faster tests
        let ms = config["seconds"].as_u64().unwrap_or(1);
        tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
        Ok(json!({ "waited_seconds": ms }))
    }
}

/// Mock loop node.
struct MockLoopNode;

#[async_trait]
impl NodeExecutor for MockLoopNode {
    fn node_type(&self) -> &'static str {
        "loop"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        if config.get("items").is_none() {
            return Err("loop node requires 'items' in config".to_string());
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let items = resolved["items"]
            .as_array()
            .ok_or("loop 'items' must be an array")?;
        let max_iterations = resolved["max_iterations"]
            .as_u64()
            .unwrap_or(items.len() as u64) as usize;

        let capped: Vec<_> = items.iter().take(max_iterations).cloned().collect();
        let first = capped.first().cloned().unwrap_or(Value::Null);

        Ok(json!({
            "current_item": first,
            "index": 0,
            "total": capped.len(),
            "items": capped,
        }))
    }
}

/// A node that always fails - for testing error propagation.
struct AlwaysFailNode;

#[async_trait]
impl NodeExecutor for AlwaysFailNode {
    fn node_type(&self) -> &'static str {
        "always_fail"
    }

    async fn execute(
        &self,
        node_id: &str,
        _config: &Value,
        _context: &ExecutionContext,
    ) -> Result<Value, String> {
        Err(format!("Node '{}' intentionally failed", node_id))
    }
}

/// A node that fails N times then succeeds - for testing retry logic.
struct FailNTimesNode {
    remaining_failures: Arc<std::sync::Mutex<u32>>,
}

impl FailNTimesNode {
    fn new(fail_count: u32) -> Self {
        Self {
            remaining_failures: Arc::new(std::sync::Mutex::new(fail_count)),
        }
    }
}

#[async_trait]
impl NodeExecutor for FailNTimesNode {
    fn node_type(&self) -> &'static str {
        "fail_n_times"
    }

    async fn execute(
        &self,
        node_id: &str,
        _config: &Value,
        _context: &ExecutionContext,
    ) -> Result<Value, String> {
        let mut remaining = self.remaining_failures.lock().unwrap();
        if *remaining > 0 {
            *remaining -= 1;
            Err(format!("Node '{}' transient failure", node_id))
        } else {
            Ok(json!({ "status": "recovered" }))
        }
    }
}

/// Mock git worktree node.
struct MockGitWorktreeNode;

#[async_trait]
impl NodeExecutor for MockGitWorktreeNode {
    fn node_type(&self) -> &'static str {
        "git.worktree"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        for field in &["worktree_path", "branch_name"] {
            if config.get(field).is_none() {
                return Err(format!("git.worktree requires '{}' in config", field));
            }
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let worktree_path = resolved["worktree_path"].as_str().unwrap_or_default();
        let branch_name = resolved["branch_name"].as_str().unwrap_or_default();

        context.set_working_dir(Some(worktree_path.to_string()));

        Ok(json!({
            "worktree_path": worktree_path,
            "branch_name": branch_name,
        }))
    }
}

/// Mock Claude analyze node.
struct MockClaudeAnalyzeNode;

#[async_trait]
impl NodeExecutor for MockClaudeAnalyzeNode {
    fn node_type(&self) -> &'static str {
        "claude.analyze"
    }

    fn validate(&self, config: &Value) -> Result<(), String> {
        if config.get("prompt").is_none() {
            return Err("claude.analyze requires 'prompt' in config".to_string());
        }
        Ok(())
    }

    async fn execute(
        &self,
        _node_id: &str,
        config: &Value,
        context: &ExecutionContext,
    ) -> Result<Value, String> {
        let resolved = context.resolve_value(config)?;
        let prompt = resolved["prompt"]
            .as_str()
            .ok_or("prompt must be a string")?;

        Ok(json!({
            "analysis": format!("Analysis of: {}", prompt),
        }))
    }
}

// ===========================================================================
// Test helpers
// ===========================================================================

fn build_default_mock_registry() -> NodeRegistry {
    let mut registry = NodeRegistry::new();
    registry.register(MockTriggerNode);
    registry.register(MockGithubSyncNode);
    registry.register(MockGithubReadIssuesNode);
    registry.register(MockGitBranchNode);
    registry.register(MockGitCommitNode);
    registry.register(MockClaudePlanNode);
    registry.register(MockClaudeApplyNode);
    registry.register(MockClaudeAnalyzeNode);
    registry.register(MockGithubCreatePrNode);
    registry.register(MockConditionNode);
    registry.register(MockDelayNode);
    registry.register(MockLoopNode);
    registry.register(MockGitWorktreeNode);
    registry
}

fn make_node(id: &str, node_type: &str, config: Option<Value>) -> WorkflowNode {
    WorkflowNode {
        id: id.to_string(),
        node_type: node_type.to_string(),
        config,
        inputs: None,
        position: None,
    }
}

fn make_edge(id: &str, source: &str, target: &str) -> WorkflowEdge {
    WorkflowEdge {
        id: id.to_string(),
        source: source.to_string(),
        target: target.to_string(),
        source_handle: None,
        target_handle: None,
    }
}

fn make_edge_with_handle(
    id: &str,
    source: &str,
    target: &str,
    source_handle: &str,
) -> WorkflowEdge {
    WorkflowEdge {
        id: id.to_string(),
        source: source.to_string(),
        target: target.to_string(),
        source_handle: Some(source_handle.to_string()),
        target_handle: None,
    }
}

fn make_workflow(
    id: &str,
    nodes: Vec<WorkflowNode>,
    edges: Vec<WorkflowEdge>,
    config: Option<Value>,
) -> Workflow {
    let now = Utc::now().to_rfc3339();
    Workflow {
        id: id.to_string(),
        name: format!("Test Workflow {}", id),
        description: None,
        nodes,
        edges,
        config,
        version: 1,
        created_at: now.clone(),
        updated_at: now,
    }
}

// ===========================================================================
// 1. Complete workflow execution (trigger -> sync -> branch -> commit)
// ===========================================================================

#[tokio::test]
async fn test_complete_workflow_execution() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node(
            "trigger",
            "trigger",
            Some(json!({"trigger_type": "manual"})),
        ),
        make_node(
            "sync",
            "github.sync",
            Some(json!({
                "owner": "phmatray",
                "repo": "test-repo",
                "path": "/tmp/repos"
            })),
        ),
        make_node(
            "branch",
            "git.branch",
            Some(json!({
                "branch_type": "feature",
                "name": "fix-login-bug"
            })),
        ),
        make_node(
            "commit",
            "git.commit",
            Some(json!({
                "commit_type": "fix",
                "scope": "auth",
                "description": "resolve login crash on Safari"
            })),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "branch"),
        make_edge("e3", "branch", "commit"),
    ];

    let workflow = make_workflow("wf-1", nodes, edges, None);

    let result = execute_workflow("exec-1", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");
    assert!(result.error.is_none());
    assert_eq!(result.node_results.len(), 4);

    // All nodes should be COMPLETED
    for nr in &result.node_results {
        assert_eq!(
            nr.status, "COMPLETED",
            "Node {} should be COMPLETED, got {}",
            nr.node_id, nr.status
        );
    }

    // Verify trigger output
    let trigger_out = result.node_results[0].output.as_ref().unwrap();
    assert_eq!(trigger_out["trigger_type"], "manual");

    // Verify sync output sets working_dir
    let sync_out = result.node_results[1].output.as_ref().unwrap();
    assert_eq!(sync_out["owner"], "phmatray");
    assert_eq!(sync_out["repo"], "test-repo");
    assert_eq!(sync_out["repo_path"], "/tmp/repos/test-repo");

    // Verify branch output
    let branch_out = result.node_results[2].output.as_ref().unwrap();
    assert_eq!(branch_out["branch_name"], "feature/fix-login-bug");

    // Verify commit output
    let commit_out = result.node_results[3].output.as_ref().unwrap();
    assert!(commit_out["message"]
        .as_str()
        .unwrap()
        .contains("fix(auth): resolve login crash on Safari"));
    assert_eq!(commit_out["sha"], "abc123def456");
}

// ===========================================================================
// 2. Full "Autonomous Developer" workflow end-to-end with mocks
// ===========================================================================

#[tokio::test]
async fn test_autonomous_developer_workflow_end_to_end() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node(
            "trigger",
            "trigger",
            Some(json!({"trigger_type": "manual"})),
        ),
        make_node(
            "sync",
            "github.sync",
            Some(json!({
                "owner": "phmatray",
                "repo": "my-app",
                "path": "/tmp/repos"
            })),
        ),
        make_node(
            "read_issues",
            "github.readIssues",
            Some(json!({
                "owner": "{{sync.owner}}",
                "repo": "{{sync.repo}}"
            })),
        ),
        make_node(
            "plan",
            "claude.plan",
            Some(json!({
                "prompt": "Plan a fix for issue #{{read_issues.count}}: {{read_issues.issues}}"
            })),
        ),
        make_node(
            "worktree",
            "git.worktree",
            Some(json!({
                "worktree_path": "/tmp/worktrees/fix-42",
                "branch_name": "feature/fix-42"
            })),
        ),
        make_node(
            "apply",
            "claude.apply",
            Some(json!({
                "prompt": "Apply the plan: {{plan.plan}}"
            })),
        ),
        make_node(
            "commit",
            "git.commit",
            Some(json!({
                "commit_type": "fix",
                "scope": "login",
                "description": "resolve issue #42"
            })),
        ),
        make_node(
            "create_pr",
            "github.createPR",
            Some(json!({
                "owner": "{{sync.owner}}",
                "repo": "{{sync.repo}}",
                "title": "Fix: {{read_issues.issues.0.title}}",
                "body": "Resolves #42",
                "head": "feature/fix-42",
                "base": "develop"
            })),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "read_issues"),
        make_edge("e3", "read_issues", "plan"),
        make_edge("e4", "plan", "worktree"),
        make_edge("e5", "worktree", "apply"),
        make_edge("e6", "apply", "commit"),
        make_edge("e7", "commit", "create_pr"),
    ];

    let workflow = make_workflow("autonomous-dev", nodes, edges, None);

    let result = execute_workflow("exec-auto", &workflow, &registry, &retry_policy).await;

    assert_eq!(
        result.status, "COMPLETED",
        "Workflow error: {:?}",
        result.error
    );
    assert_eq!(result.node_results.len(), 8);

    // All nodes should be COMPLETED
    for nr in &result.node_results {
        assert_eq!(
            nr.status, "COMPLETED",
            "Node {} should be COMPLETED, got {}. Error: {:?}",
            nr.node_id, nr.status, nr.error
        );
    }

    // Verify template resolution propagated through the pipeline
    let issues_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "read_issues")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    assert_eq!(issues_out["count"], 1);
    assert_eq!(issues_out["issues"][0]["number"], 42);

    // Verify the plan referenced the issue
    let plan_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "plan")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    let plan_text = plan_out["plan"].as_str().unwrap();
    assert!(
        plan_text.contains("1") && plan_text.contains("42"),
        "Plan should reference issue count and issue #42, got: {}",
        plan_text
    );

    // Verify the PR references the issue title
    let pr_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "create_pr")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    assert_eq!(pr_out["number"], 101);
    let pr_title = pr_out["title"].as_str().unwrap();
    assert!(
        pr_title.contains("Fix login bug"),
        "PR title should reference the issue title, got: {}",
        pr_title
    );
}

// ===========================================================================
// 3. Template resolution through multiple nodes
// ===========================================================================

#[tokio::test]
async fn test_template_resolution_through_pipeline() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "sync",
            "github.sync",
            Some(json!({
                "owner": "test-org",
                "repo": "test-project",
                "path": "/tmp/repos"
            })),
        ),
        make_node(
            "branch",
            "git.branch",
            Some(json!({
                "name": "issue-{{sync.repo}}"
            })),
        ),
        make_node(
            "commit",
            "git.commit",
            Some(json!({
                "commit_type": "feat",
                "description": "work on {{branch.branch_name}}"
            })),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "branch"),
        make_edge("e3", "branch", "commit"),
    ];

    let workflow = make_workflow("wf-template", nodes, edges, None);
    let result = execute_workflow("exec-tpl", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    // Verify the branch name resolved from sync output
    let branch_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "branch")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    assert_eq!(
        branch_out["branch_name"], "feature/issue-test-project",
        "Branch name should include resolved repo name"
    );

    // Verify the commit message references the branch name
    let commit_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "commit")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    let msg = commit_out["message"].as_str().unwrap();
    assert!(
        msg.contains("feature/issue-test-project"),
        "Commit message should reference the branch name, got: {}",
        msg
    );
}

// ===========================================================================
// 4. Condition branching - true branch taken
// ===========================================================================

#[tokio::test]
async fn test_condition_branching_true_branch() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    // Workflow:
    //   trigger -> sync -> read_issues -> condition
    //                                    /        \
    //                             (true) plan    (false) commit_skip

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "sync",
            "github.sync",
            Some(json!({"owner": "o", "repo": "r", "path": "/tmp"})),
        ),
        make_node(
            "read_issues",
            "github.readIssues",
            Some(json!({"owner": "{{sync.owner}}", "repo": "{{sync.repo}}"})),
        ),
        make_node(
            "condition",
            "condition",
            Some(json!({
                "condition": "{{read_issues.issues}}",
                "operator": "not_empty"
            })),
        ),
        make_node(
            "plan",
            "claude.plan",
            Some(json!({"prompt": "Plan fix for issues"})),
        ),
        make_node(
            "skip_node",
            "git.commit",
            Some(json!({"commit_type": "chore", "description": "no issues"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "read_issues"),
        make_edge("e3", "read_issues", "condition"),
        make_edge_with_handle("e4", "condition", "plan", "true"),
        make_edge_with_handle("e5", "condition", "skip_node", "false"),
    ];

    let workflow = make_workflow("wf-cond-true", nodes, edges, None);
    let result = execute_workflow("exec-ct", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    // Condition should evaluate to true (count=1 > 0)
    let cond_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "condition")
        .unwrap();
    assert_eq!(cond_out.status, "COMPLETED");
    assert_eq!(cond_out.output.as_ref().unwrap()["branch"], "true");

    // Plan node should be COMPLETED
    let plan = result
        .node_results
        .iter()
        .find(|r| r.node_id == "plan")
        .unwrap();
    assert_eq!(plan.status, "COMPLETED");

    // Skip node should be SKIPPED
    let skip = result
        .node_results
        .iter()
        .find(|r| r.node_id == "skip_node")
        .unwrap();
    assert_eq!(skip.status, "SKIPPED");
}

// ===========================================================================
// 5. Condition branching - false branch taken
// ===========================================================================

#[tokio::test]
async fn test_condition_branching_false_branch() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "condition",
            "condition",
            Some(json!({
                "condition": "",
                "operator": "not_empty"
            })),
        ),
        make_node(
            "true_branch",
            "claude.plan",
            Some(json!({"prompt": "should not run"})),
        ),
        make_node(
            "false_branch",
            "claude.plan",
            Some(json!({"prompt": "should run"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "condition"),
        make_edge_with_handle("e2", "condition", "true_branch", "true"),
        make_edge_with_handle("e3", "condition", "false_branch", "false"),
    ];

    let workflow = make_workflow("wf-cond-false", nodes, edges, None);
    let result = execute_workflow("exec-cf", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    // Condition evaluates to false (empty string is not_empty => false)
    let cond = result
        .node_results
        .iter()
        .find(|r| r.node_id == "condition")
        .unwrap();
    assert_eq!(cond.output.as_ref().unwrap()["branch"], "false");

    // True branch should be SKIPPED
    let true_br = result
        .node_results
        .iter()
        .find(|r| r.node_id == "true_branch")
        .unwrap();
    assert_eq!(true_br.status, "SKIPPED");

    // False branch should be COMPLETED
    let false_br = result
        .node_results
        .iter()
        .find(|r| r.node_id == "false_branch")
        .unwrap();
    assert_eq!(false_br.status, "COMPLETED");
}

// ===========================================================================
// 6. Cycle detection with various DAG shapes
// ===========================================================================

#[tokio::test]
async fn test_cycle_detection_simple_cycle() {
    let nodes = vec![
        make_node("a", "trigger", None),
        make_node("b", "trigger", None),
    ];
    let edges = vec![make_edge("e1", "a", "b"), make_edge("e2", "b", "a")];

    let result = build_dag(&nodes, &edges);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("cycle"));
}

#[tokio::test]
async fn test_cycle_detection_three_node_cycle() {
    let nodes = vec![
        make_node("a", "trigger", None),
        make_node("b", "trigger", None),
        make_node("c", "trigger", None),
    ];
    let edges = vec![
        make_edge("e1", "a", "b"),
        make_edge("e2", "b", "c"),
        make_edge("e3", "c", "a"),
    ];

    let result = build_dag(&nodes, &edges);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("cycle"));
}

#[tokio::test]
async fn test_cycle_detection_self_loop() {
    let nodes = vec![make_node("a", "trigger", None)];
    let edges = vec![make_edge("e1", "a", "a")];

    let result = build_dag(&nodes, &edges);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("cycle"));
}

#[tokio::test]
async fn test_no_cycle_diamond_shape() {
    //     A
    //    / \
    //   B   C
    //    \ /
    //     D
    let nodes = vec![
        make_node("a", "trigger", None),
        make_node("b", "trigger", None),
        make_node("c", "trigger", None),
        make_node("d", "trigger", None),
    ];
    let edges = vec![
        make_edge("e1", "a", "b"),
        make_edge("e2", "a", "c"),
        make_edge("e3", "b", "d"),
        make_edge("e4", "c", "d"),
    ];

    let result = build_dag(&nodes, &edges);
    assert!(result.is_ok());

    let dag = result.unwrap();
    // Level 0: A, Level 1: B+C, Level 2: D
    assert_eq!(dag.levels.len(), 3);
    assert_eq!(dag.levels[0].len(), 1); // A
    assert_eq!(dag.levels[1].len(), 2); // B, C
    assert_eq!(dag.levels[2].len(), 1); // D
}

#[tokio::test]
async fn test_no_cycle_wide_dag() {
    //   A
    //  /|\
    // B C D
    let nodes = vec![
        make_node("a", "trigger", None),
        make_node("b", "trigger", None),
        make_node("c", "trigger", None),
        make_node("d", "trigger", None),
    ];
    let edges = vec![
        make_edge("e1", "a", "b"),
        make_edge("e2", "a", "c"),
        make_edge("e3", "a", "d"),
    ];

    let dag = build_dag(&nodes, &edges).unwrap();
    assert_eq!(dag.levels.len(), 2);
    assert_eq!(dag.levels[0].len(), 1); // A
    assert_eq!(dag.levels[1].len(), 3); // B, C, D
}

#[tokio::test]
async fn test_no_cycle_linear_chain() {
    let nodes = vec![
        make_node("a", "trigger", None),
        make_node("b", "trigger", None),
        make_node("c", "trigger", None),
        make_node("d", "trigger", None),
    ];
    let edges = vec![
        make_edge("e1", "a", "b"),
        make_edge("e2", "b", "c"),
        make_edge("e3", "c", "d"),
    ];

    let dag = build_dag(&nodes, &edges).unwrap();
    assert_eq!(dag.levels.len(), 4);
    for level in &dag.levels {
        assert_eq!(level.len(), 1);
    }
}

#[tokio::test]
async fn test_disconnected_nodes() {
    let nodes = vec![
        make_node("a", "trigger", None),
        make_node("b", "trigger", None),
        make_node("c", "trigger", None),
    ];
    let edges = vec![]; // No edges at all

    let dag = build_dag(&nodes, &edges).unwrap();
    // All nodes are in level 0 (no dependencies)
    assert_eq!(dag.levels.len(), 1);
    assert_eq!(dag.levels[0].len(), 3);
}

#[tokio::test]
async fn test_invalid_edge_unknown_source() {
    let nodes = vec![make_node("a", "trigger", None)];
    let edges = vec![make_edge("e1", "nonexistent", "a")];

    let result = build_dag(&nodes, &edges);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("unknown source"));
}

#[tokio::test]
async fn test_invalid_edge_unknown_target() {
    let nodes = vec![make_node("a", "trigger", None)];
    let edges = vec![make_edge("e1", "a", "nonexistent")];

    let result = build_dag(&nodes, &edges);
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("unknown target"));
}

// ===========================================================================
// 7. Error propagation from node to workflow
// ===========================================================================

#[tokio::test]
async fn test_error_propagation_stops_workflow() {
    let mut registry = build_default_mock_registry();
    registry.register(AlwaysFailNode);

    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node("fail_node", "always_fail", None),
        make_node(
            "should_not_run",
            "claude.plan",
            Some(json!({"prompt": "this should never execute"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "fail_node"),
        make_edge("e2", "fail_node", "should_not_run"),
    ];

    let workflow = make_workflow("wf-error", nodes, edges, None);
    let result = execute_workflow("exec-err", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "FAILED");
    assert!(result.error.is_some());
    assert!(result.error.as_ref().unwrap().contains("fail_node"));

    // Trigger should be COMPLETED
    let trigger = result
        .node_results
        .iter()
        .find(|r| r.node_id == "trigger")
        .unwrap();
    assert_eq!(trigger.status, "COMPLETED");

    // Fail node should be FAILED
    let fail = result
        .node_results
        .iter()
        .find(|r| r.node_id == "fail_node")
        .unwrap();
    assert_eq!(fail.status, "FAILED");

    // Downstream node should be SKIPPED
    let skipped = result
        .node_results
        .iter()
        .find(|r| r.node_id == "should_not_run")
        .unwrap();
    assert_eq!(skipped.status, "SKIPPED");
}

#[tokio::test]
async fn test_unknown_node_type_fails_workflow() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node("unknown", "nonexistent.node", None),
    ];

    let edges = vec![make_edge("e1", "trigger", "unknown")];

    let workflow = make_workflow("wf-unknown", nodes, edges, None);
    let result = execute_workflow("exec-unknown", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "FAILED");
    assert!(result.error.as_ref().unwrap().contains("Unknown node type"));
}

#[tokio::test]
async fn test_validation_failure_stops_workflow() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        // Missing required "owner", "repo", "path" fields
        make_node("sync", "github.sync", Some(json!({}))),
        make_node(
            "branch",
            "git.branch",
            Some(json!({"name": "should-not-reach"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "branch"),
    ];

    let workflow = make_workflow("wf-validation", nodes, edges, None);
    let result = execute_workflow("exec-val", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "FAILED");
    assert!(result.error.as_ref().unwrap().contains("validation failed"));
}

// ===========================================================================
// 8. Retry logic
// ===========================================================================

#[tokio::test]
async fn test_retry_succeeds_on_second_attempt() {
    let mut registry = build_default_mock_registry();
    // Fails once, then succeeds
    registry.register(FailNTimesNode::new(1));

    let retry_policy = RetryPolicy {
        max_retries: 2,
        retry_delay_ms: 1, // 1ms delay for fast tests
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node("retry_node", "fail_n_times", None),
    ];

    let edges = vec![make_edge("e1", "trigger", "retry_node")];

    let workflow = make_workflow("wf-retry-ok", nodes, edges, None);
    let result = execute_workflow("exec-retry-ok", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    let retry = result
        .node_results
        .iter()
        .find(|r| r.node_id == "retry_node")
        .unwrap();
    assert_eq!(retry.status, "COMPLETED");
    assert_eq!(retry.retry_count, 1, "Should have retried once");
}

#[tokio::test]
async fn test_retry_exhausted_fails_workflow() {
    let mut registry = build_default_mock_registry();
    // Fails 5 times (more than max_retries)
    registry.register(FailNTimesNode::new(5));

    let retry_policy = RetryPolicy {
        max_retries: 2,
        retry_delay_ms: 1,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node("retry_node", "fail_n_times", None),
    ];

    let edges = vec![make_edge("e1", "trigger", "retry_node")];

    let workflow = make_workflow("wf-retry-fail", nodes, edges, None);
    let result = execute_workflow("exec-retry-fail", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "FAILED");

    let retry = result
        .node_results
        .iter()
        .find(|r| r.node_id == "retry_node")
        .unwrap();
    assert_eq!(retry.status, "FAILED");
    assert_eq!(
        retry.retry_count, 2,
        "Should have exhausted all retries (0, 1, 2)"
    );
}

#[tokio::test]
async fn test_retry_zero_retries_fails_immediately() {
    let mut registry = build_default_mock_registry();
    registry.register(FailNTimesNode::new(1));

    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node("retry_node", "fail_n_times", None),
    ];

    let edges = vec![make_edge("e1", "trigger", "retry_node")];

    let workflow = make_workflow("wf-retry-zero", nodes, edges, None);
    let result = execute_workflow("exec-retry-zero", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "FAILED");

    let retry = result
        .node_results
        .iter()
        .find(|r| r.node_id == "retry_node")
        .unwrap();
    assert_eq!(retry.status, "FAILED");
    assert_eq!(retry.retry_count, 0, "Should fail on first attempt");
}

// ===========================================================================
// 9. Concurrent workflow execution (multiple workflows in parallel)
// ===========================================================================

#[tokio::test]
async fn test_concurrent_workflow_executions() {
    let registry = Arc::new(build_default_mock_registry());
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let mut handles = Vec::new();

    for i in 0..5 {
        let registry = Arc::clone(&registry);
        let retry_policy = retry_policy.clone();

        handles.push(tokio::spawn(async move {
            let nodes = vec![
                make_node("trigger", "trigger", None),
                make_node(
                    "sync",
                    "github.sync",
                    Some(json!({
                        "owner": format!("owner-{}", i),
                        "repo": format!("repo-{}", i),
                        "path": "/tmp/repos"
                    })),
                ),
                make_node(
                    "branch",
                    "git.branch",
                    Some(json!({
                        "name": format!("fix-{}", i)
                    })),
                ),
            ];

            let edges = vec![
                make_edge("e1", "trigger", "sync"),
                make_edge("e2", "sync", "branch"),
            ];

            let workflow = make_workflow(&format!("wf-{}", i), nodes, edges, None);

            let result =
                execute_workflow(&format!("exec-{}", i), &workflow, &registry, &retry_policy).await;

            assert_eq!(
                result.status, "COMPLETED",
                "Workflow {} failed: {:?}",
                i, result.error
            );
            assert_eq!(result.node_results.len(), 3);

            // Verify each workflow operated on its own data
            let sync_out = result
                .node_results
                .iter()
                .find(|r| r.node_id == "sync")
                .unwrap()
                .output
                .as_ref()
                .unwrap();
            assert_eq!(sync_out["owner"], format!("owner-{}", i));
            assert_eq!(sync_out["repo"], format!("repo-{}", i));

            result
        }));
    }

    let results: Vec<_> = futures::future::join_all(handles)
        .await
        .into_iter()
        .map(|r| r.unwrap())
        .collect();

    // All 5 workflows should have completed independently
    assert_eq!(results.len(), 5);
    for result in &results {
        assert_eq!(result.status, "COMPLETED");
    }
}

// ===========================================================================
// 10. Working directory propagation
// ===========================================================================

#[tokio::test]
async fn test_working_dir_propagation() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "sync",
            "github.sync",
            Some(json!({
                "owner": "test",
                "repo": "myrepo",
                "path": "/workspace"
            })),
        ),
        make_node(
            "worktree",
            "git.worktree",
            Some(json!({
                "worktree_path": "/workspace/worktrees/fix",
                "branch_name": "feature/fix"
            })),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "worktree"),
    ];

    let workflow = make_workflow("wf-wd", nodes, edges, None);
    let result = execute_workflow("exec-wd", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    // Sync should set working_dir to /workspace/myrepo
    let sync_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "sync")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    assert_eq!(sync_out["repo_path"], "/workspace/myrepo");

    // Worktree should update working_dir
    let wt_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "worktree")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    assert_eq!(wt_out["worktree_path"], "/workspace/worktrees/fix");
}

// ===========================================================================
// 11. Empty workflow
// ===========================================================================

#[tokio::test]
async fn test_empty_workflow_succeeds() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let workflow = make_workflow("wf-empty", vec![], vec![], None);
    let result = execute_workflow("exec-empty", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");
    assert!(result.node_results.is_empty());
    assert!(result.error.is_none());
}

// ===========================================================================
// 12. Single node workflow
// ===========================================================================

#[tokio::test]
async fn test_single_node_workflow() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![make_node(
        "trigger",
        "trigger",
        Some(json!({"trigger_type": "webhook"})),
    )];

    let workflow = make_workflow("wf-single", nodes, vec![], None);
    let result = execute_workflow("exec-single", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");
    assert_eq!(result.node_results.len(), 1);
    assert_eq!(result.node_results[0].status, "COMPLETED");
    assert_eq!(
        result.node_results[0].output.as_ref().unwrap()["trigger_type"],
        "webhook"
    );
}

// ===========================================================================
// 13. Loop node integration
// ===========================================================================

#[tokio::test]
async fn test_loop_node_with_literal_array() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "loop_items",
            "loop",
            Some(json!({
                "items": [
                    {"number": 1, "title": "First issue"},
                    {"number": 2, "title": "Second issue"},
                    {"number": 3, "title": "Third issue"}
                ],
                "max_iterations": 2
            })),
        ),
    ];

    let edges = vec![make_edge("e1", "trigger", "loop_items")];

    let workflow = make_workflow("wf-loop", nodes, edges, None);
    let result = execute_workflow("exec-loop", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    let loop_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "loop_items")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    // max_iterations=2 caps the items to 2
    assert_eq!(loop_out["total"], 2);
    assert_eq!(loop_out["current_item"]["number"], 1);
    assert_eq!(loop_out["items"].as_array().unwrap().len(), 2);
}

// ===========================================================================
// 14. Delay node integration
// ===========================================================================

#[tokio::test]
async fn test_delay_node_in_workflow() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node("delay", "delay", Some(json!({"seconds": 1}))), // 1ms in mock
        make_node(
            "after_delay",
            "claude.plan",
            Some(json!({"prompt": "After delay"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "delay"),
        make_edge("e2", "delay", "after_delay"),
    ];

    let workflow = make_workflow("wf-delay", nodes, edges, None);
    let result = execute_workflow("exec-delay", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");
    assert_eq!(result.node_results.len(), 3);

    for nr in &result.node_results {
        assert_eq!(nr.status, "COMPLETED");
    }
}

// ===========================================================================
// 15. DAG topological sort correctly orders nodes
// ===========================================================================

#[tokio::test]
async fn test_dag_topological_order_preserved() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    //   trigger -> sync -> branch -> commit
    //                 \               /
    //                  -> plan ------
    // This creates a diamond where plan and branch are at the same level,
    // and commit depends on both.

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "sync",
            "github.sync",
            Some(json!({"owner": "o", "repo": "r", "path": "/tmp"})),
        ),
        make_node("branch", "git.branch", Some(json!({"name": "fix"}))),
        make_node(
            "plan",
            "claude.plan",
            Some(json!({"prompt": "plan something"})),
        ),
        make_node(
            "commit",
            "git.commit",
            Some(json!({"commit_type": "fix", "description": "fix bug"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "branch"),
        make_edge("e3", "sync", "plan"),
        make_edge("e4", "branch", "commit"),
        make_edge("e5", "plan", "commit"),
    ];

    let workflow = make_workflow("wf-topo", nodes, edges, None);
    let result = execute_workflow("exec-topo", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");
    assert_eq!(result.node_results.len(), 5);

    // Verify ordering: trigger and sync executed before branch/plan, commit last
    let order: Vec<&str> = result
        .node_results
        .iter()
        .map(|r| r.node_id.as_str())
        .collect();

    let trigger_pos = order.iter().position(|&n| n == "trigger").unwrap();
    let sync_pos = order.iter().position(|&n| n == "sync").unwrap();
    let branch_pos = order.iter().position(|&n| n == "branch").unwrap();
    let plan_pos = order.iter().position(|&n| n == "plan").unwrap();
    let commit_pos = order.iter().position(|&n| n == "commit").unwrap();

    assert!(trigger_pos < sync_pos);
    assert!(sync_pos < branch_pos);
    assert!(sync_pos < plan_pos);
    assert!(branch_pos < commit_pos);
    assert!(plan_pos < commit_pos);
}

// ===========================================================================
// 16. Mid-string template resolution
// ===========================================================================

#[tokio::test]
async fn test_mid_string_template_resolution() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "sync",
            "github.sync",
            Some(json!({"owner": "org", "repo": "project", "path": "/tmp"})),
        ),
        make_node(
            "plan",
            "claude.plan",
            Some(json!({
                "prompt": "Fix issue in /repos/{{sync.owner}}/{{sync.repo}}/src"
            })),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "sync"),
        make_edge("e2", "sync", "plan"),
    ];

    let workflow = make_workflow("wf-midstr", nodes, edges, None);
    let result = execute_workflow("exec-midstr", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    let plan_out = result
        .node_results
        .iter()
        .find(|r| r.node_id == "plan")
        .unwrap()
        .output
        .as_ref()
        .unwrap();
    let plan_text = plan_out["plan"].as_str().unwrap();
    assert!(
        plan_text.contains("/repos/org/project/src"),
        "Mid-string template should be resolved, got: {}",
        plan_text
    );
}

// ===========================================================================
// 17. Multiple template references in one string
// ===========================================================================

#[tokio::test]
async fn test_multiple_template_refs_in_one_string() {
    let ctx = ExecutionContext::new(json!({}));
    ctx.set_node_output("user".into(), json!({"name": "Alice"}));
    ctx.set_node_output("repo".into(), json!({"name": "my-app"}));

    let input = json!({"path": "/repos/{{user.name}}/{{repo.name}}/issues"});
    let resolved = ctx.resolve_value(&input).unwrap();
    assert_eq!(resolved["path"], "/repos/Alice/my-app/issues");
}

// ===========================================================================
// 18. Nested template references
// ===========================================================================

#[tokio::test]
async fn test_nested_template_reference() {
    let ctx = ExecutionContext::new(json!({}));
    ctx.set_node_output(
        "data".into(),
        json!({"nested": {"deep": {"value": "found_it"}}}),
    );

    let resolved = ctx.resolve_reference("{{data.nested.deep.value}}").unwrap();
    assert_eq!(resolved, "found_it");
}

// ===========================================================================
// 19. Template resolution error for missing reference
// ===========================================================================

#[tokio::test]
async fn test_template_resolution_missing_node_fails() {
    let ctx = ExecutionContext::new(json!({}));
    let input = json!({"field": "{{nonexistent.value}}"});
    let result = ctx.resolve_value(&input);
    assert!(result.is_err());
}

#[tokio::test]
async fn test_template_resolution_missing_field_fails() {
    let ctx = ExecutionContext::new(json!({}));
    ctx.set_node_output("node".into(), json!({"existing": "value"}));
    let input = json!({"field": "{{node.missing_field}}"});
    let result = ctx.resolve_value(&input);
    assert!(result.is_err());
}

// ===========================================================================
// 20. Condition with eq operator
// ===========================================================================

#[tokio::test]
async fn test_condition_eq_operator() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node(
            "cond",
            "condition",
            Some(json!({
                "condition": "open",
                "operator": "eq",
                "value": "open"
            })),
        ),
        make_node(
            "true_action",
            "claude.plan",
            Some(json!({"prompt": "handle open"})),
        ),
        make_node(
            "false_action",
            "claude.plan",
            Some(json!({"prompt": "handle closed"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "cond"),
        make_edge_with_handle("e2", "cond", "true_action", "true"),
        make_edge_with_handle("e3", "cond", "false_action", "false"),
    ];

    let workflow = make_workflow("wf-eq", nodes, edges, None);
    let result = execute_workflow("exec-eq", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");

    let true_node = result
        .node_results
        .iter()
        .find(|r| r.node_id == "true_action")
        .unwrap();
    assert_eq!(true_node.status, "COMPLETED");

    let false_node = result
        .node_results
        .iter()
        .find(|r| r.node_id == "false_action")
        .unwrap();
    assert_eq!(false_node.status, "SKIPPED");
}

// ===========================================================================
// 21. DAG validation - rejects cycle in workflow execution
// ===========================================================================

#[tokio::test]
async fn test_workflow_execution_rejects_cycle() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    let nodes = vec![
        make_node("a", "trigger", None),
        make_node("b", "trigger", None),
        make_node("c", "trigger", None),
    ];

    let edges = vec![
        make_edge("e1", "a", "b"),
        make_edge("e2", "b", "c"),
        make_edge("e3", "c", "a"), // Creates a cycle
    ];

    let workflow = make_workflow("wf-cycle", nodes, edges, None);
    let result = execute_workflow("exec-cycle", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "FAILED");
    assert!(result
        .error
        .as_ref()
        .unwrap()
        .to_lowercase()
        .contains("cycle"));
}

// ===========================================================================
// 22. Parallel nodes at the same level
// ===========================================================================

#[tokio::test]
async fn test_parallel_nodes_at_same_level() {
    let registry = build_default_mock_registry();
    let retry_policy = RetryPolicy {
        max_retries: 0,
        retry_delay_ms: 0,
    };

    //   trigger
    //   /  |  \
    //  a   b   c
    //   \  |  /
    //    commit

    let nodes = vec![
        make_node("trigger", "trigger", None),
        make_node("a", "claude.plan", Some(json!({"prompt": "task a"}))),
        make_node("b", "claude.plan", Some(json!({"prompt": "task b"}))),
        make_node("c", "claude.plan", Some(json!({"prompt": "task c"}))),
        make_node(
            "commit",
            "git.commit",
            Some(json!({"commit_type": "feat", "description": "combined"})),
        ),
    ];

    let edges = vec![
        make_edge("e1", "trigger", "a"),
        make_edge("e2", "trigger", "b"),
        make_edge("e3", "trigger", "c"),
        make_edge("e4", "a", "commit"),
        make_edge("e5", "b", "commit"),
        make_edge("e6", "c", "commit"),
    ];

    let workflow = make_workflow("wf-parallel", nodes, edges, None);
    let result = execute_workflow("exec-parallel", &workflow, &registry, &retry_policy).await;

    assert_eq!(result.status, "COMPLETED");
    assert_eq!(result.node_results.len(), 5);

    // All nodes should be completed
    for nr in &result.node_results {
        assert_eq!(nr.status, "COMPLETED");
    }
}

// ===========================================================================
// 23. Execution context isolation between workflows
// ===========================================================================

#[tokio::test]
async fn test_execution_context_isolation() {
    let ctx1 = ExecutionContext::new(json!({}));
    let ctx2 = ExecutionContext::new(json!({}));

    ctx1.set_node_output("node1".into(), json!({"val": "from_ctx1"}));
    ctx2.set_node_output("node1".into(), json!({"val": "from_ctx2"}));

    assert_eq!(ctx1.get_node_output("node1").unwrap()["val"], "from_ctx1");
    assert_eq!(ctx2.get_node_output("node1").unwrap()["val"], "from_ctx2");

    // ctx1 should not see ctx2's data
    assert!(ctx1.get_node_output("node2").is_none());
}

// ===========================================================================
// 24. Working dir context propagation across nodes
// ===========================================================================

#[tokio::test]
async fn test_working_dir_shared_across_context() {
    let ctx = ExecutionContext::new(json!({}));

    assert!(ctx.get_working_dir().is_none());

    ctx.set_working_dir(Some("/path/to/repo".to_string()));
    assert_eq!(ctx.get_working_dir().unwrap(), "/path/to/repo");

    ctx.set_working_dir(Some("/path/to/worktree".to_string()));
    assert_eq!(ctx.get_working_dir().unwrap(), "/path/to/worktree");

    ctx.set_working_dir(None);
    assert!(ctx.get_working_dir().is_none());
}
