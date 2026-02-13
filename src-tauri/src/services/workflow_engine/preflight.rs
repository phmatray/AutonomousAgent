use super::executor;
use super::node_registry::{NodeRegistry, ServiceProvider};
use crate::models::workflow::{Workflow, WorkflowNode};
use crate::services::git_service::GitService;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

const ACTIVE_SESSION_CREDENTIAL_ID: &str = "__active_session__";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightIssue {
    pub level: String,
    pub code: String,
    pub message: String,
    pub node_id: Option<String>,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPreflightResult {
    pub valid: bool,
    pub issues: Vec<PreflightIssue>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
struct NodeSpecCatalog {
    nodes: Vec<NodeSpec>,
}

#[derive(Debug, Clone, Deserialize)]
struct NodeSpec {
    #[serde(rename = "type")]
    node_type: String,
    fields: Vec<FieldSpec>,
    outputs: Vec<OutputSpec>,
}

#[derive(Debug, Clone, Deserialize)]
struct FieldSpec {
    key: String,
    label: String,
    #[serde(rename = "type")]
    field_type: String,
    required: bool,
    #[serde(default, rename = "pathSensitive")]
    path_sensitive: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct OutputSpec {
    name: String,
}

fn node_specs() -> &'static HashMap<String, NodeSpec> {
    static NODE_SPECS: OnceLock<HashMap<String, NodeSpec>> = OnceLock::new();
    NODE_SPECS.get_or_init(|| {
        let raw = include_str!("../../../../src/shared/node-specs.json");
        let catalog: NodeSpecCatalog =
            serde_json::from_str(raw).expect("shared node-specs catalog must be valid JSON");
        catalog
            .nodes
            .into_iter()
            .map(|node| (node.node_type.clone(), node))
            .collect()
    })
}

fn template_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{([^}]+)\}\}").unwrap())
}

fn is_template_string(input: &str) -> bool {
    input.contains("{{") && input.contains("}}")
}

fn issue_error(
    code: &str,
    message: impl Into<String>,
    node_id: Option<&str>,
    hint: Option<&str>,
) -> PreflightIssue {
    PreflightIssue {
        level: "ERROR".to_string(),
        code: code.to_string(),
        message: message.into(),
        node_id: node_id.map(String::from),
        hint: hint.map(String::from),
    }
}

fn issue_warn(
    code: &str,
    message: impl Into<String>,
    node_id: Option<&str>,
    hint: Option<&str>,
) -> PreflightIssue {
    PreflightIssue {
        level: "WARN".to_string(),
        code: code.to_string(),
        message: message.into(),
        node_id: node_id.map(String::from),
        hint: hint.map(String::from),
    }
}

fn collect_template_references(value: &Value, refs: &mut Vec<String>) {
    match value {
        Value::String(s) => {
            if s.contains("{{") {
                for capture in template_regex().captures_iter(s) {
                    refs.push(capture[1].trim().to_string());
                }
            }
        }
        Value::Array(values) => {
            for v in values {
                collect_template_references(v, refs);
            }
        }
        Value::Object(map) => {
            for v in map.values() {
                collect_template_references(v, refs);
            }
        }
        _ => {}
    }
}

fn check_required_and_type_fields(
    node: &WorkflowNode,
    spec: &NodeSpec,
    issues: &mut Vec<PreflightIssue>,
) {
    let config = node
        .config
        .as_ref()
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    for field in &spec.fields {
        let value = config.get(&field.key);

        if field.required {
            let missing = match value {
                None | Some(Value::Null) => true,
                Some(Value::String(s)) => s.trim().is_empty(),
                _ => false,
            };
            if missing {
                issues.push(issue_error(
                    "PRE-REQ-001",
                    format!("{} is required", field.label),
                    Some(&node.id),
                    Some("Fill this field in the node configuration before execution."),
                ));
            }
        }

        if field.field_type == "number" {
            if let Some(existing) = value {
                if !existing.is_null() {
                    let valid_number = existing.is_number()
                        || existing
                            .as_str()
                            .map(|raw| raw.trim().parse::<f64>().is_ok())
                            .unwrap_or(false);
                    if !valid_number {
                        issues.push(issue_error(
                            "PRE-TYPE-001",
                            format!("{} must be a number", field.label),
                            Some(&node.id),
                            None,
                        ));
                    }
                }
            }
        }
    }
}

fn check_template_references(
    node: &WorkflowNode,
    node_ids: &HashSet<String>,
    output_map: &HashMap<String, HashSet<String>>,
    issues: &mut Vec<PreflightIssue>,
) {
    let config = node
        .config
        .as_ref()
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    let mut refs = Vec::new();
    collect_template_references(&config, &mut refs);

    for reference in refs {
        let mut parts = reference.split('.');
        let ref_node_id = parts.next().unwrap_or_default().trim();
        let ref_field = parts.next().map(str::trim);

        if ref_node_id.is_empty() || !node_ids.contains(ref_node_id) {
            issues.push(issue_error(
                "PRE-TPL-001",
                format!("Unknown template node reference: '{{{{{}}}}}'", reference),
                Some(&node.id),
                Some("Use a node ID that exists upstream in your workflow."),
            ));
            continue;
        }

        if let Some(field) = ref_field {
            if let Some(known_outputs) = output_map.get(ref_node_id) {
                if !known_outputs.is_empty() && !known_outputs.contains(field) {
                    issues.push(issue_warn(
                        "PRE-TPL-002",
                        format!(
                            "Template '{{{{{}}}}}' references output '{}' that is not declared for node '{}'.",
                            reference, field, ref_node_id
                        ),
                        Some(&node.id),
                        Some("Verify the output variable name in the template picker."),
                    ));
                }
            }
        }
    }
}

fn check_path_fields(node: &WorkflowNode, spec: &NodeSpec, issues: &mut Vec<PreflightIssue>) {
    let config = node
        .config
        .as_ref()
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    for field in &spec.fields {
        if !field.path_sensitive {
            continue;
        }

        let Some(raw_path) = config.get(&field.key).and_then(|v| v.as_str()) else {
            continue;
        };
        if raw_path.trim().is_empty() || is_template_string(raw_path) {
            continue;
        }

        if !Path::new(raw_path).exists() {
            issues.push(issue_warn(
                "PRE-PATH-001",
                format!(
                    "Path '{}' for '{}' does not exist on this machine.",
                    raw_path, field.label
                ),
                Some(&node.id),
                Some("Create the path or switch to a valid existing location."),
            ));
        }
    }
}

fn branch_exists(repo_path: &str, branch_name: &str) -> bool {
    let Ok(repo) = git2::Repository::open(repo_path) else {
        return false;
    };

    let exists = repo
        .find_branch(branch_name, git2::BranchType::Local)
        .is_ok();
    exists
}

fn check_branch_conflicts(node: &WorkflowNode, issues: &mut Vec<PreflightIssue>) {
    let config = node
        .config
        .as_ref()
        .cloned()
        .unwrap_or(Value::Object(Default::default()));

    if node.node_type == "git.branch" {
        let Some(repo_path) = config.get("repo_path").and_then(|v| v.as_str()) else {
            return;
        };
        let Some(raw_name) = config.get("name").and_then(|v| v.as_str()) else {
            return;
        };
        if is_template_string(repo_path) || is_template_string(raw_name) {
            return;
        }

        let branch_type = config
            .get("branch_type")
            .and_then(|v| v.as_str())
            .unwrap_or("feature");
        let branch_name = GitService::gitflow_branch_name(branch_type, raw_name);

        if Path::new(repo_path).exists() && branch_exists(repo_path, &branch_name) {
            issues.push(issue_warn(
                "PRE-BRANCH-001",
                format!("Branch '{}' already exists in {}.", branch_name, repo_path),
                Some(&node.id),
                Some("Use a new branch name to avoid branch creation failures."),
            ));
        }
    }

    if node.node_type == "git.worktree" {
        let Some(repo_path) = config.get("repo_path").and_then(|v| v.as_str()) else {
            return;
        };
        let Some(branch_name) = config.get("branch_name").and_then(|v| v.as_str()) else {
            return;
        };
        if is_template_string(repo_path) || is_template_string(branch_name) {
            return;
        }

        if Path::new(repo_path).exists() && branch_exists(repo_path, branch_name) {
            issues.push(issue_warn(
                "PRE-BRANCH-002",
                format!(
                    "Worktree branch '{}' already exists in {}.",
                    branch_name, repo_path
                ),
                Some(&node.id),
                Some("Pick a unique branch name for worktree creation."),
            ));
        }
    }
}

fn check_join_policy(
    nodes: &[WorkflowNode],
    edges: &[crate::models::workflow::WorkflowEdge],
    issues: &mut Vec<PreflightIssue>,
) {
    let mut incoming_count: HashMap<&str, usize> = HashMap::new();
    for edge in edges {
        *incoming_count.entry(edge.target.as_str()).or_insert(0) += 1;
    }

    for node in nodes {
        let count = incoming_count.get(node.id.as_str()).copied().unwrap_or(0);
        if count <= 1 {
            continue;
        }

        let join_policy = node
            .config
            .as_ref()
            .and_then(|cfg| cfg.get("join_policy"))
            .and_then(|v| v.as_str());

        match join_policy {
            Some("all") | Some("any") => {}
            Some(other) => {
                issues.push(issue_error(
                    "PRE-JOIN-001",
                    format!("Invalid join_policy '{}' (expected 'all' or 'any').", other),
                    Some(&node.id),
                    None,
                ));
            }
            None => {
                issues.push(issue_warn(
                    "PRE-JOIN-002",
                    format!(
                        "Node '{}' has {} inbound edges but no explicit join policy.",
                        node.id, count
                    ),
                    Some(&node.id),
                    Some("Set join_policy to 'all' or 'any' to make merge behavior explicit."),
                ));
            }
        }
    }
}

async fn check_github_credentials(
    node: &WorkflowNode,
    services: Option<&ServiceProvider>,
    issues: &mut Vec<PreflightIssue>,
) {
    let uses_github_auth =
        node.node_type.starts_with("github.") || node.node_type == "backlog.syncIssues";

    if !uses_github_auth {
        return;
    }

    let Some(services) = services else {
        issues.push(issue_warn(
            "PRE-AUTH-000",
            "Cannot verify GitHub credentials because services are not initialized.",
            Some(&node.id),
            None,
        ));
        return;
    };

    let config = node
        .config
        .as_ref()
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    let credential_id = config
        .get("credential_id")
        .and_then(|v| v.as_str())
        .and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

    if credential_id == Some(ACTIVE_SESSION_CREDENTIAL_ID)
        && services.github.get_authenticated_user().await.is_err()
    {
        issues.push(issue_error(
            "PRE-AUTH-001",
            "Node requires active session credentials, but no active GitHub session is available.",
            Some(&node.id),
            Some("Reconnect GitHub in Settings and retry preflight."),
        ));
        return;
    }

    if services
        .storage
        .get_github_token_for_credential_or_default(credential_id)
        .is_ok()
    {
        return;
    }

    if services.github.get_authenticated_user().await.is_err() {
        let issue = if node.node_type == "github.sync" {
            issue_warn(
                "PRE-AUTH-003",
                "No GitHub credential found. github.sync may still work for public repositories.",
                Some(&node.id),
                Some("Add credentials to avoid rate limits/private repo failures."),
            )
        } else {
            issue_error(
                "PRE-AUTH-002",
                "No usable GitHub credential found for this node.",
                Some(&node.id),
                Some("Set credential_id or configure a default GitHub token in Settings."),
            )
        };
        issues.push(issue);
    }
}

pub async fn run_preflight(
    workflow: &Workflow,
    registry: &NodeRegistry,
    services: Option<&ServiceProvider>,
) -> WorkflowPreflightResult {
    let mut issues = Vec::new();

    if let Err(err) = executor::validate_dag(&workflow.nodes, &workflow.edges) {
        issues.push(issue_error(
            "PRE-DAG-001",
            format!("Workflow graph is invalid: {}", err),
            None,
            Some("Remove cycles and ensure all edges reference valid node IDs."),
        ));
    }

    let specs = node_specs();

    let node_id_set: HashSet<String> = workflow.nodes.iter().map(|n| n.id.clone()).collect();
    let output_map: HashMap<String, HashSet<String>> = workflow
        .nodes
        .iter()
        .map(|node| {
            let outputs = specs
                .get(&node.node_type)
                .map(|spec| {
                    spec.outputs
                        .iter()
                        .map(|output| output.name.clone())
                        .collect::<HashSet<_>>()
                })
                .unwrap_or_default();
            (node.id.clone(), outputs)
        })
        .collect();

    check_join_policy(&workflow.nodes, &workflow.edges, &mut issues);

    for node in &workflow.nodes {
        if !registry.has(&node.node_type) {
            issues.push(issue_error(
                "PRE-NODE-001",
                format!("Unknown node type '{}'.", node.node_type),
                Some(&node.id),
                None,
            ));
            continue;
        }

        let Some(spec) = specs.get(&node.node_type) else {
            issues.push(issue_warn(
                "PRE-NODE-002",
                format!(
                    "No shared node specification found for '{}'; preflight checks are limited.",
                    node.node_type
                ),
                Some(&node.id),
                None,
            ));
            continue;
        };

        check_required_and_type_fields(node, spec, &mut issues);
        check_template_references(node, &node_id_set, &output_map, &mut issues);
        check_path_fields(node, spec, &mut issues);
        check_branch_conflicts(node, &mut issues);
        check_github_credentials(node, services, &mut issues).await;
    }

    let valid = !issues.iter().any(|issue| issue.level == "ERROR");
    WorkflowPreflightResult {
        valid,
        issues,
        generated_at: chrono::Utc::now().to_rfc3339(),
    }
}
