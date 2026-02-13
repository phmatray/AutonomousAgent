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
    pub output: Option<Value>,
    pub error: Option<String>,
    pub started_at: String,
    pub completed_at: String,
    pub retry_count: u32,
}

/// Configuration for the retry policy of a workflow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub retry_delay_ms: u64,
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
    let mut in_degree: HashMap<String, usize> = HashMap::new();
    let node_map: HashMap<String, WorkflowNode> =
        nodes.iter().map(|n| (n.id.clone(), n.clone())).collect();

    // Initialize all nodes
    for node in nodes {
        adjacency.entry(node.id.clone()).or_default();
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
        in_degree,
        nodes: node_map,
        levels,
    })
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

    // Track which nodes have been skipped due to failed conditions
    let mut skipped_nodes: HashSet<String> = HashSet::new();
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
                    output: None,
                    error: Some("Skipped due to prior failure".into()),
                    started_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: chrono::Utc::now().to_rfc3339(),
                    retry_count: 0,
                });
            }
            continue;
        }

        // Execute all nodes in this level concurrently
        // For now, execute sequentially within a level for simplicity and
        // because the shared mutable ExecutionContext doesn't lend itself to
        // true parallelism without additional synchronization.
        for node_id in level {
            if skipped_nodes.contains(node_id) {
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: NodeState::Skipped.as_str().to_string(),
                    output: None,
                    error: None,
                    started_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: chrono::Utc::now().to_rfc3339(),
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
                        status: NodeState::Failed.as_str().to_string(),
                        output: None,
                        error: workflow_error.clone(),
                        started_at: chrono::Utc::now().to_rfc3339(),
                        completed_at: chrono::Utc::now().to_rfc3339(),
                        retry_count: 0,
                    });
                    break;
                }
            };

            let config = node
                .config
                .clone()
                .unwrap_or(Value::Object(Default::default()));

            // Validate node config
            if let Err(e) = executor.validate(&config) {
                failed = true;
                workflow_error = Some(format!("Node {} validation failed: {}", node_id, e));
                node_results.push(NodeExecutionResult {
                    node_id: node_id.clone(),
                    status: NodeState::Failed.as_str().to_string(),
                    output: None,
                    error: workflow_error.clone(),
                    started_at: chrono::Utc::now().to_rfc3339(),
                    completed_at: chrono::Utc::now().to_rfc3339(),
                    retry_count: 0,
                });
                break;
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

            for attempt in 0..=retry_policy.max_retries {
                retry_count = attempt;

                if attempt > 0 {
                    log::warn!(
                        "[Workflow:{}] [Execution:{}] Retrying node '{}' (attempt {}/{})",
                        workflow.id,
                        execution_id,
                        node_id,
                        attempt + 1,
                        retry_policy.max_retries + 1
                    );
                }

                let attempt_start = std::time::Instant::now();
                match executor.execute(node_id, &config, &context, services).await {
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
                        if attempt < retry_policy.max_retries {
                            tokio::time::sleep(tokio::time::Duration::from_millis(
                                retry_policy.retry_delay_ms,
                            ))
                            .await;
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

            if let Some(output) = node_output {
                // Store output in context for downstream nodes
                context.set_node_output(node_id.clone(), output.clone());

                // Handle condition nodes -- skip branches based on result
                if node.node_type == "condition" {
                    let branch = output["branch"].as_str().unwrap_or("true");
                    if let Some(successors) = dag.adjacency.get(node_id) {
                        for succ_id in successors {
                            // Find the edge to determine which handle it connects to
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
                    status: NodeState::Completed.as_str().to_string(),
                    output: Some(output),
                    error: None,
                    started_at: node_started,
                    completed_at: node_completed,
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
                    status: NodeState::Failed.as_str().to_string(),
                    output: None,
                    error: last_error,
                    started_at: node_started,
                    completed_at: node_completed,
                    retry_count,
                });
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

/// Recursively mark a node and all its descendants as skipped.
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
}
