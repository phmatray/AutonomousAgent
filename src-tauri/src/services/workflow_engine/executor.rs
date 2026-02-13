use crate::errors::{AppError, Result};
use crate::models::workflow::{Workflow, WorkflowEdge, WorkflowNode};
use crate::services::workflow_engine::node_registry::{
    ExecutionContext, NodeRegistry, ServiceProvider,
};
use crate::services::workflow_engine::state_machine::{NodeState, WorkflowState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet, VecDeque};

/// Result of executing a single node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeExecutionResult {
    pub node_id: String,
    pub status: String,
    pub resolved_config: Option<Value>,
    pub input: Option<Value>,
    pub output: Option<Value>,
    pub error: Option<String>,
    pub started_at: String,
    pub completed_at: String,
    pub duration_ms: u64,
    pub retry_count: u32,
    pub policy: EffectiveNodeExecutionPolicy,
}

/// Configuration for the retry policy of a workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub retry_delay_ms: u64,
}

/// Effective retry/timeout policy used for a specific node execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectiveNodeExecutionPolicy {
    pub max_retries: u32,
    pub retry_delay_ms: u64,
    pub backoff: String,
    pub timeout_secs: Option<u64>,
    pub continue_on_error: bool,
}

impl Default for EffectiveNodeExecutionPolicy {
    fn default() -> Self {
        Self {
            max_retries: 2,
            retry_delay_ms: 1000,
            backoff: "linear".to_string(),
            timeout_secs: None,
            continue_on_error: false,
        }
    }
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 2,
            retry_delay_ms: 1000,
        }
    }
}

/// Full result of a workflow execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowExecutionResult {
    pub execution_id: String,
    pub workflow_id: String,
    pub status: String,
    pub node_results: Vec<NodeExecutionResult>,
    pub started_at: String,
    pub completed_at: String,
    pub error: Option<String>,
}

/// Adjacency information built from the workflow definition.
#[derive(Debug)]
#[allow(dead_code)]
struct DagInfo {
    /// node_id -> list of successor node IDs
    adjacency: HashMap<String, Vec<String>>,
    /// node_id -> outgoing edges
    outgoing_edges: HashMap<String, Vec<WorkflowEdge>>,
    /// node_id -> incoming edges
    incoming_edges: HashMap<String, Vec<WorkflowEdge>>,
    /// node_id -> number of predecessors
    in_degree: HashMap<String, usize>,
    /// node_id -> WorkflowNode
    nodes: HashMap<String, WorkflowNode>,
    /// Topologically sorted levels: each level is a vec of node IDs
    /// that can be executed in parallel.
    levels: Vec<Vec<String>>,
}

/// Build a DAG from workflow nodes and edges, validate it, and compute execution levels.
fn build_dag(nodes: &[WorkflowNode], edges: &[WorkflowEdge]) -> Result<DagInfo> {
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();
    let mut outgoing_edges: HashMap<String, Vec<WorkflowEdge>> = HashMap::new();
    let mut incoming_edges: HashMap<String, Vec<WorkflowEdge>> = HashMap::new();
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let node_map: HashMap<String, WorkflowNode> =
        nodes.iter().map(|n| (n.id.clone(), n.clone())).collect();

    // Initialize all nodes
    for node in nodes {
        adjacency.entry(node.id.clone()).or_default();
        outgoing_edges.entry(node.id.clone()).or_default();
        incoming_edges.entry(node.id.clone()).or_default();
        in_degree.entry(node.id.clone()).or_insert(0);
    }

    // Build adjacency from edges
    for edge in edges {
        if !node_map.contains_key(&edge.source) {
            return Err(AppError::Validation(format!(
                "Edge references unknown source node: {}",
                edge.source
            )));
        }
        if !node_map.contains_key(&edge.target) {
            return Err(AppError::Validation(format!(
                "Edge references unknown target node: {}",
                edge.target
            )));
        }

        adjacency
            .entry(edge.source.clone())
            .or_default()
            .push(edge.target.clone());
        outgoing_edges
            .entry(edge.source.clone())
            .or_default()
            .push(edge.clone());
        incoming_edges
            .entry(edge.target.clone())
            .or_default()
            .push(edge.clone());
        *in_degree.entry(edge.target.clone()).or_insert(0) += 1;
    }

    // Topological sort using Kahn's algorithm to detect cycles and compute levels
    let mut queue: VecDeque<String> = VecDeque::new();
    let mut remaining_in_degree = in_degree.clone();

    for (node_id, &deg) in &remaining_in_degree {
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
                    let deg = remaining_in_degree.get_mut(succ).unwrap();
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
        return Err(AppError::Validation(
            "Workflow DAG contains a cycle".to_string(),
        ));
    }

    Ok(DagInfo {
        adjacency,
        outgoing_edges,
        incoming_edges,
        in_degree,
        nodes: node_map,
        levels,
    })
}

/// Validate workflow graph topology and edge references.
pub fn validate_dag(nodes: &[WorkflowNode], edges: &[WorkflowEdge]) -> Result<()> {
    build_dag(nodes, edges).map(|_| ())
}

fn parse_bool_like(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(v)) => Some(*v),
        Some(Value::String(s)) => match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        },
        Some(Value::Number(n)) => n.as_i64().map(|v| v != 0),
        _ => None,
    }
}

fn effective_policy_for_node(
    config: &Value,
    workflow_retry: &RetryPolicy,
) -> EffectiveNodeExecutionPolicy {
    let mut policy = EffectiveNodeExecutionPolicy {
        max_retries: workflow_retry.max_retries,
        retry_delay_ms: workflow_retry.retry_delay_ms,
        backoff: "linear".to_string(),
        timeout_secs: None,
        continue_on_error: false,
    };

    // Support both legacy top-level overrides and structured execution_policy object.
    let exec_policy = config
        .get("execution_policy")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    policy.max_retries = exec_policy
        .get("max_retries")
        .and_then(|v| v.as_u64())
        .or_else(|| config.get("_max_retries").and_then(|v| v.as_u64()))
        .map(|v| v as u32)
        .unwrap_or(policy.max_retries);

    policy.retry_delay_ms = exec_policy
        .get("retry_delay_ms")
        .and_then(|v| v.as_u64())
        .or_else(|| config.get("_retry_delay_ms").and_then(|v| v.as_u64()))
        .unwrap_or(policy.retry_delay_ms);

    policy.timeout_secs = exec_policy
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .or_else(|| config.get("_timeout_secs").and_then(|v| v.as_u64()));

    policy.continue_on_error = parse_bool_like(exec_policy.get("continue_on_error"))
        .or_else(|| parse_bool_like(config.get("_continue_on_error")))
        .unwrap_or(false);

    let backoff = exec_policy
        .get("backoff")
        .and_then(|v| v.as_str())
        .or_else(|| config.get("_backoff").and_then(|v| v.as_str()))
        .unwrap_or("linear")
        .to_ascii_lowercase();
    policy.backoff = if backoff == "exponential" {
        "exponential".to_string()
    } else {
        "linear".to_string()
    };

    policy
}

fn retry_delay_for_attempt(policy: &EffectiveNodeExecutionPolicy, attempt: u32) -> u64 {
    if attempt == 0 {
        return 0;
    }
    if policy.backoff == "exponential" {
        let multiplier = 2u64.saturating_pow(attempt.saturating_sub(1));
        policy.retry_delay_ms.saturating_mul(multiplier)
    } else {
        policy.retry_delay_ms
    }
}

fn join_policy_for_node(node: &WorkflowNode) -> &'static str {
    node.config
        .as_ref()
        .and_then(|cfg| cfg.get("join_policy"))
        .and_then(|v| v.as_str())
        .map(|v| {
            if v.eq_ignore_ascii_case("any") {
                "any"
            } else {
                "all"
            }
        })
        .unwrap_or("all")
}

fn should_execute_node(
    node: &WorkflowNode,
    dag: &DagInfo,
    inactive_edges: &HashSet<String>,
) -> bool {
    let incoming = dag
        .incoming_edges
        .get(&node.id)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if incoming.is_empty() {
        return true;
    }

    let active_inputs = incoming
        .iter()
        .filter(|edge| !inactive_edges.contains(&edge.id))
        .count();

    if incoming.len() == 1 {
        return active_inputs == 1;
    }

    match join_policy_for_node(node) {
        "any" => active_inputs > 0,
        _ => active_inputs == incoming.len(),
    }
}

fn deactivate_outgoing_edges(node_id: &str, dag: &DagInfo, inactive_edges: &mut HashSet<String>) {
    if let Some(edges) = dag.outgoing_edges.get(node_id) {
        for edge in edges {
            inactive_edges.insert(edge.id.clone());
        }
    }
}

/// Execute a workflow as a DAG, level by level.
pub async fn execute_workflow(
    execution_id: &str,
    workflow: &Workflow,
    registry: &NodeRegistry,
    services: &ServiceProvider,
    retry_policy: &RetryPolicy,
) -> WorkflowExecutionResult {
    let workflow_start_time = std::time::Instant::now();
    let started_at = chrono::Utc::now().to_rfc3339();
    let mut node_results: Vec<NodeExecutionResult> = Vec::new();

    log::info!(
        "[Workflow:{}] [Execution:{}] Starting workflow execution - '{}' with {} nodes, {} edges",
        workflow.id,
        execution_id,
        workflow.name,
        workflow.nodes.len(),
        workflow.edges.len()
    );

    // Build the DAG
    let dag = match build_dag(&workflow.nodes, &workflow.edges) {
        Ok(d) => {
            log::info!(
                "[Workflow:{}] [Execution:{}] DAG built successfully with {} execution levels",
                workflow.id,
                execution_id,
                d.levels.len()
            );
            d
        }
        Err(e) => {
            log::error!(
                "[Workflow:{}] [Execution:{}] DAG validation failed: {}",
                workflow.id,
                execution_id,
                e
            );
            return WorkflowExecutionResult {
                execution_id: execution_id.to_string(),
                workflow_id: workflow.id.clone(),
                status: WorkflowState::Failed.as_str().to_string(),
                node_results,
                started_at: started_at.clone(),
                completed_at: chrono::Utc::now().to_rfc3339(),
                error: Some(format!("DAG validation failed: {}", e)),
            };
        }
    };

    // Validate all node types exist in the registry
    for node in &workflow.nodes {
        if !registry.has(&node.node_type) {
            return WorkflowExecutionResult {
                execution_id: execution_id.to_string(),
                workflow_id: workflow.id.clone(),
                status: WorkflowState::Failed.as_str().to_string(),
                node_results,
                started_at: started_at.clone(),
                completed_at: chrono::Utc::now().to_rfc3339(),
                error: Some(format!("Unknown node type: {}", node.node_type)),
            };
        }
    }

    // Create execution context from workflow config
    let context = ExecutionContext::new(
        workflow
            .config
            .clone()
            .unwrap_or(Value::Object(Default::default())),
    );

    // Track inactive edges caused by branching decisions, skips, and recoverable failures.
    let mut inactive_edges: HashSet<String> = HashSet::new();
    let mut failed = false;
    let mut workflow_error: Option<String> = None;

    // Execute level by level
    for level in &dag.levels {
        if failed {
            // Mark remaining nodes as skipped
            for node_id in level {
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: NodeState::Skipped.as_str().to_string(),
                    resolved_config: None,
                    input: None,
                    output: None,
                    error: Some("Skipped due to prior failure".into()),
                    started_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: chrono::Utc::now().to_rfc3339(),
                    duration_ms: 0,
                    retry_count: 0,
                    policy: EffectiveNodeExecutionPolicy::default(),
                });
                deactivate_outgoing_edges(node_id, &dag, &mut inactive_edges);
            }
            continue;
        }

        // Execute nodes in topological order.
        for node_id in level {
            let node = &dag.nodes[node_id];
            if !should_execute_node(node, &dag, &inactive_edges) {
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: NodeState::Skipped.as_str().to_string(),
                    resolved_config: None,
                    input: None,
                    output: None,
                    error: Some(
                        "Skipped because no active inbound branch reached this node".into(),
                    ),
                    started_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: chrono::Utc::now().to_rfc3339(),
                    duration_ms: 0,
                    retry_count: 0,
                    policy: EffectiveNodeExecutionPolicy::default(),
                });
                deactivate_outgoing_edges(node_id, &dag, &mut inactive_edges);
                continue;
            }

            let executor = match registry.get(&node.node_type) {
                Ok(e) => e,
                Err(e) => {
                    failed = true;
                    workflow_error = Some(format!("Node {}: {}", node_id, e));
                    node_results.push(NodeExecutionResult {
                        node_id: node_id.clone(),
                        status: NodeState::Failed.as_str().to_string(),
                        resolved_config: None,
                        input: None,
                        output: None,
                        error: workflow_error.clone(),
                        started_at: chrono::Utc::now().to_rfc3339(),
                        completed_at: chrono::Utc::now().to_rfc3339(),
                        duration_ms: 0,
                        retry_count: 0,
                        policy: EffectiveNodeExecutionPolicy::default(),
                    });
                    break;
                }
            };

            let config = node
                .config
                .clone()
                .unwrap_or(Value::Object(Default::default()));
            let policy = effective_policy_for_node(&config, retry_policy);
            let resolved_config = context.resolve_value(&config).ok();

            // Validate node config
            if let Err(e) = executor.validate(&config) {
                let message = format!("Node {} validation failed: {}", node_id, e);
                if !policy.continue_on_error {
                    failed = true;
                    workflow_error = Some(message.clone());
                }
                deactivate_outgoing_edges(node_id, &dag, &mut inactive_edges);
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: NodeState::Failed.as_str().to_string(),
                    resolved_config: resolved_config.clone(),
                    input: Some(config.clone()),
                    output: None,
                    error: Some(message),
                    started_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: chrono::Utc::now().to_rfc3339(),
                    duration_ms: 0,
                    retry_count: 0,
                    policy: policy.clone(),
                });
                if failed {
                    break;
                }
                continue;
            }

            // Execute with retries
            let node_start_time = std::time::Instant::now();
            let node_started = chrono::Utc::now().to_rfc3339();
            let mut last_error = None;
            let mut retry_count = 0u32;
            let mut node_output = None;

            // Log node execution start
            log::info!(
                "[Workflow:{}] [Execution:{}] Starting node '{}' (type: {})",
                workflow.id,
                execution_id,
                node_id,
                node.node_type
            );

            for attempt in 0..=policy.max_retries {
                retry_count = attempt;

                if attempt > 0 {
                    log::warn!(
                        "[Workflow:{}] [Execution:{}] Retrying node '{}' (attempt {}/{})",
                        workflow.id,
                        execution_id,
                        node_id,
                        attempt + 1,
                        policy.max_retries + 1
                    );
                }

                let attempt_start = std::time::Instant::now();
                let execution_result = if let Some(timeout_secs) = policy.timeout_secs {
                    match tokio::time::timeout(
                        tokio::time::Duration::from_secs(timeout_secs),
                        executor.execute(node_id, &config, &context, services),
                    )
                    .await
                    {
                        Ok(result) => result,
                        Err(_) => Err(AppError::Timeout),
                    }
                } else {
                    executor.execute(node_id, &config, &context, services).await
                };

                match execution_result {
                    Ok(output) => {
                        let attempt_duration = attempt_start.elapsed();
                        log::info!(
                            "[Workflow:{}] [Execution:{}] Node '{}' completed successfully in {:?}{}",
                            workflow.id,
                            execution_id,
                            node_id,
                            attempt_duration,
                            if attempt > 0 { format!(" (after {} retries)", attempt) } else { String::new() }
                        );
                        node_output = Some(output);
                        last_error = None;
                        break;
                    }
                    Err(e) => {
                        let attempt_duration = attempt_start.elapsed();
                        log::error!(
                            "[Workflow:{}] [Execution:{}] Node '{}' failed after {:?}: {}",
                            workflow.id,
                            execution_id,
                            node_id,
                            attempt_duration,
                            e
                        );
                        last_error = Some(format!("{}", e));
                        if attempt < policy.max_retries {
                            let delay_ms = retry_delay_for_attempt(&policy, attempt + 1);
                            tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
                        }
                    }
                }
            }

            let node_completed = chrono::Utc::now().to_rfc3339();
            let total_node_duration = node_start_time.elapsed();

            log::info!(
                "[Workflow:{}] [Execution:{}] Node '{}' total execution time: {:?}",
                workflow.id,
                execution_id,
                node_id,
                total_node_duration
            );
            let duration_ms = total_node_duration.as_millis() as u64;

            if let Some(output) = node_output {
                // Store output in context for downstream nodes
                context.set_node_output(node_id.clone(), output.clone());

                // Handle condition nodes by deactivating non-selected edges.
                if node.node_type == "condition" {
                    let branch = output["branch"].as_str().unwrap_or("true");
                    if let Some(edges) = dag.outgoing_edges.get(node_id) {
                        for edge in edges {
                            let handle = edge.source_handle.as_deref().unwrap_or("true");
                            if handle != branch {
                                inactive_edges.insert(edge.id.clone());
                            }
                        }
                    }
                }
                if node.node_type == "loop" && output["total"].as_u64().unwrap_or(0) == 0 {
                    deactivate_outgoing_edges(node_id, &dag, &mut inactive_edges);
                }

                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: NodeState::Completed.as_str().to_string(),
                    resolved_config: resolved_config.clone(),
                    input: Some(config.clone()),
                    output: Some(output),
                    error: None,
                    started_at: node_started,
                    completed_at: node_completed,
                    duration_ms,
                    retry_count,
                    policy: policy.clone(),
                });
            } else {
                let failure_message = format!(
                    "Node {} failed after {} retries: {}",
                    node_id,
                    retry_count,
                    last_error.as_deref().unwrap_or("unknown error")
                );
                if !policy.continue_on_error {
                    failed = true;
                    workflow_error = Some(failure_message);
                }
                deactivate_outgoing_edges(node_id, &dag, &mut inactive_edges);
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: NodeState::Failed.as_str().to_string(),
                    resolved_config: resolved_config.clone(),
                    input: Some(config.clone()),
                    output: None,
                    error: last_error,
                    started_at: node_started,
                    completed_at: node_completed,
                    duration_ms,
                    retry_count,
                    policy: policy.clone(),
                });
                if failed {
                    break;
                }
            }
        }
    }

    let final_status = if failed {
        WorkflowState::Failed
    } else {
        WorkflowState::Completed
    };

    let workflow_duration = workflow_start_time.elapsed();
    let completed_at = chrono::Utc::now().to_rfc3339();

    // Count node statuses
    let completed_count = node_results
        .iter()
        .filter(|r| r.status == NodeState::Completed.as_str())
        .count();
    let failed_count = node_results
        .iter()
        .filter(|r| r.status == NodeState::Failed.as_str())
        .count();
    let skipped_count = node_results
        .iter()
        .filter(|r| r.status == NodeState::Skipped.as_str())
        .count();

    if failed {
        log::error!(
            "[Workflow:{}] [Execution:{}] Workflow FAILED after {:?} - {} completed, {} failed, {} skipped. Error: {}",
            workflow.id,
            execution_id,
            workflow_duration,
            completed_count,
            failed_count,
            skipped_count,
            workflow_error.as_deref().unwrap_or("unknown")
        );
    } else {
        log::info!(
            "[Workflow:{}] [Execution:{}] Workflow completed successfully in {:?} - {} nodes executed, {} skipped",
            workflow.id,
            execution_id,
            workflow_duration,
            completed_count,
            skipped_count
        );
    }

    WorkflowExecutionResult {
        execution_id: execution_id.to_string(),
        workflow_id: workflow.id.clone(),
        status: final_status.as_str().to_string(),
        node_results,
        started_at,
        completed_at,
        error: workflow_error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::workflow::{WorkflowEdge, WorkflowNode};

    #[test]
    fn test_build_dag_simple() {
        let nodes = vec![
            WorkflowNode {
                id: "a".into(),
                node_type: "trigger".into(),
                config: None,
                inputs: None,
                position: None,
            },
            WorkflowNode {
                id: "b".into(),
                node_type: "github.sync".into(),
                config: None,
                inputs: None,
                position: None,
            },
        ];
        let edges = vec![WorkflowEdge {
            id: "e1".into(),
            source: "a".into(),
            target: "b".into(),
            source_handle: None,
            target_handle: None,
        }];

        let dag = build_dag(&nodes, &edges).unwrap();
        assert_eq!(dag.levels.len(), 2);
        assert_eq!(dag.levels[0], vec!["a".to_string()]);
        assert_eq!(dag.levels[1], vec!["b".to_string()]);
    }

    #[test]
    fn test_build_dag_cycle_detection() {
        let nodes = vec![
            WorkflowNode {
                id: "a".into(),
                node_type: "trigger".into(),
                config: None,
                inputs: None,
                position: None,
            },
            WorkflowNode {
                id: "b".into(),
                node_type: "trigger".into(),
                config: None,
                inputs: None,
                position: None,
            },
        ];
        let edges = vec![
            WorkflowEdge {
                id: "e1".into(),
                source: "a".into(),
                target: "b".into(),
                source_handle: None,
                target_handle: None,
            },
            WorkflowEdge {
                id: "e2".into(),
                source: "b".into(),
                target: "a".into(),
                source_handle: None,
                target_handle: None,
            },
        ];

        let result = build_dag(&nodes, &edges);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cycle"));
    }

    #[test]
    fn test_should_execute_node_with_any_join_policy_when_one_input_inactive() {
        let nodes = vec![
            WorkflowNode {
                id: "a".into(),
                node_type: "trigger".into(),
                config: None,
                inputs: None,
                position: None,
            },
            WorkflowNode {
                id: "b".into(),
                node_type: "trigger".into(),
                config: None,
                inputs: None,
                position: None,
            },
            WorkflowNode {
                id: "join".into(),
                node_type: "claude.plan".into(),
                config: Some(serde_json::json!({ "join_policy": "any" })),
                inputs: None,
                position: None,
            },
        ];

        let edges = vec![
            WorkflowEdge {
                id: "e1".into(),
                source: "a".into(),
                target: "join".into(),
                source_handle: None,
                target_handle: None,
            },
            WorkflowEdge {
                id: "e2".into(),
                source: "b".into(),
                target: "join".into(),
                source_handle: None,
                target_handle: None,
            },
        ];

        let dag = build_dag(&nodes, &edges).unwrap();
        let join = dag.nodes.get("join").unwrap();

        let mut inactive_edges = HashSet::new();
        inactive_edges.insert("e2".to_string());
        assert!(should_execute_node(join, &dag, &inactive_edges));
    }
}
