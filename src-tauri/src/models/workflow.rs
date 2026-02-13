use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
    pub config: Option<serde_json::Value>,
    pub version: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,
    pub config: Option<serde_json::Value>,
    pub inputs: Option<serde_json::Value>,
    pub position: Option<NodePosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub source_handle: Option<String>,
    pub target_handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowExecution {
    pub id: String,
    pub workflow_id: String,
    pub status: String,
    pub trigger_type: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
    pub context: Option<serde_json::Value>,
    pub current_node_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::Workflow;

    #[test]
    fn workflow_deserializes_from_frontend_camel_case_payload() {
        let payload = serde_json::json!({
            "id": "wf-1",
            "name": "Save Test Workflow",
            "description": "Regression coverage for save payload shape",
            "nodes": [
                {
                    "id": "node-1",
                    "type": "trigger",
                    "config": { "trigger_type": "manual" },
                    "position": { "x": 10.0, "y": 20.0 }
                }
            ],
            "edges": [
                {
                    "id": "edge-1",
                    "source": "node-1",
                    "target": "node-2",
                    "sourceHandle": "true",
                    "targetHandle": "in"
                }
            ],
            "config": { "retry": false },
            "version": 1,
            "createdAt": "2026-02-13T10:00:00Z",
            "updatedAt": "2026-02-13T10:00:00Z"
        });

        let workflow: Workflow =
            serde_json::from_value(payload).expect("frontend workflow payload should deserialize");

        assert_eq!(workflow.id, "wf-1");
        assert_eq!(workflow.name, "Save Test Workflow");
        assert_eq!(workflow.nodes[0].node_type, "trigger");
        assert_eq!(workflow.edges[0].source_handle.as_deref(), Some("true"));
        assert_eq!(workflow.created_at, "2026-02-13T10:00:00Z");
        assert_eq!(workflow.updated_at, "2026-02-13T10:00:00Z");
    }
}
