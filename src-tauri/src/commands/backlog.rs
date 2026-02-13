use crate::errors::{AppError, Result};
use crate::models::backlog::{BacklogFilters, BacklogItem, BacklogTriageUpdate};
use crate::models::workflow::{NodePosition, Workflow, WorkflowEdge, WorkflowNode};
use crate::services::workflow_engine::node_registry::{ClaudeProvider, ClaudeRunner};
use crate::services::AppState;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListBacklogItemsRequest {
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub state_filter: Option<String>,
    pub label: Option<String>,
    pub search: Option<String>,
    pub triage_status: Option<String>,
    pub priority: Option<String>,
    pub linked: Option<bool>,
}

#[tauri::command]
pub async fn list_backlog_items(
    filters: Option<ListBacklogItemsRequest>,
    state: State<'_, AppState>,
) -> Result<Vec<BacklogItem>> {
    let filters = filters.unwrap_or_default();
    let filters = BacklogFilters {
        owner: filters.owner,
        repo: filters.repo,
        state: filters.state_filter,
        label: filters.label,
        search: filters.search,
        triage_status: filters.triage_status,
        priority: filters.priority,
        linked: filters.linked,
    };
    state.backlog.list_backlog_items(&filters).await
}

#[tauri::command]
pub async fn sync_github_issues_to_backlog(
    owner: String,
    repo: String,
    state: State<'_, AppState>,
) -> Result<Vec<BacklogItem>> {
    crate::commands::github::ensure_github_authenticated(&state).await?;
    let issues = state.github.list_issues(&owner, &repo).await?;
    state
        .backlog
        .sync_issues_to_backlog(&owner, &repo, issues)
        .await
}

#[tauri::command]
pub async fn link_backlog_to_workflow(
    backlog_item_id: String,
    workflow_id: String,
    state: State<'_, AppState>,
) -> Result<()> {
    state
        .backlog
        .link_to_workflow(&backlog_item_id, &workflow_id)
        .await
}

#[tauri::command]
pub async fn delete_backlog_item(id: String, state: State<'_, AppState>) -> Result<()> {
    state.backlog.delete_backlog_item(&id).await
}

#[tauri::command]
pub async fn update_backlog_item_triage(
    backlog_item_id: String,
    triage_status: Option<String>,
    priority: Option<String>,
    effort: Option<String>,
    impact: Option<String>,
    rank: Option<i64>,
    state: State<'_, AppState>,
) -> Result<BacklogItem> {
    let update = BacklogTriageUpdate {
        triage_status,
        priority,
        effort,
        impact,
        rank,
    };
    state
        .backlog
        .update_backlog_triage(&backlog_item_id, &update)
        .await
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BulkBacklogTriageRequest {
    pub ids: Vec<String>,
    pub triage_status: Option<String>,
    pub priority: Option<String>,
    pub effort: Option<String>,
    pub impact: Option<String>,
    pub rank: Option<i64>,
    pub archive: Option<bool>,
}

#[tauri::command]
pub async fn bulk_update_backlog_triage(
    request: BulkBacklogTriageRequest,
    state: State<'_, AppState>,
) -> Result<u64> {
    if request.archive.unwrap_or(false) {
        return state.backlog.delete_backlog_items(&request.ids).await;
    }

    let update = BacklogTriageUpdate {
        triage_status: request.triage_status,
        priority: request.priority,
        effort: request.effort,
        impact: request.impact,
        rank: request.rank,
    };
    state
        .backlog
        .bulk_update_backlog_triage(&request.ids, &update)
        .await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLinkedWorkflowResponse {
    pub workflow: Workflow,
    pub backlog_item: BacklogItem,
    pub used_fallback_guidelines: bool,
}

#[tauri::command]
pub async fn create_linked_workflow_from_backlog(
    backlog_item_id: String,
    state: State<'_, AppState>,
) -> Result<CreateLinkedWorkflowResponse> {
    let backlog_item = state
        .backlog
        .get_backlog_item(&backlog_item_id)
        .await?
        .ok_or_else(|| {
            AppError::Validation(format!("Backlog item {} not found", backlog_item_id))
        })?;

    let (resolution_guidelines_md, used_fallback_guidelines) =
        generate_resolution_guidelines(&backlog_item).await;

    let workflow = build_linked_workflow(&backlog_item, &resolution_guidelines_md);
    let created_workflow = state.engine.create_workflow(&workflow).await?;

    let updated_backlog_item = match state
        .backlog
        .update_link_and_guidelines(
            &backlog_item.id,
            &created_workflow.id,
            &resolution_guidelines_md,
        )
        .await
    {
        Ok(item) => item,
        Err(error) => {
            let _ = state.engine.delete_workflow(&created_workflow.id).await;
            return Err(error);
        }
    };

    Ok(CreateLinkedWorkflowResponse {
        workflow: created_workflow,
        backlog_item: updated_backlog_item,
        used_fallback_guidelines,
    })
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let mut collected = String::new();

    for _ in 0..max_chars {
        match chars.next() {
            Some(ch) => collected.push(ch),
            None => return collected,
        }
    }

    if chars.next().is_some() {
        format!("{}...", collected.trim_end())
    } else {
        collected
    }
}

fn build_workflow_name(backlog_item: &BacklogItem) -> String {
    let normalized_title = backlog_item
        .title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let short_title = truncate_chars(&normalized_title, 64);
    format!("Issue #{} {}", backlog_item.issue_number, short_title)
}

fn build_guidelines_prompt(backlog_item: &BacklogItem) -> String {
    let labels = if backlog_item.labels.is_empty() {
        "none".to_string()
    } else {
        backlog_item.labels.join(", ")
    };
    let assignees = if backlog_item.assignees.is_empty() {
        "none".to_string()
    } else {
        backlog_item.assignees.join(", ")
    };
    let body = truncate_chars(
        backlog_item
            .body
            .as_deref()
            .unwrap_or("No issue body provided."),
        6000,
    );

    format!(
        "You are a senior software engineer preparing autonomous execution guidance.\n\
         Analyze the GitHub issue below and return ONLY markdown.\n\n\
         Issue Context:\n\
         - Repository: {owner}/{repo}\n\
         - Issue Number: #{issue_number}\n\
         - Title: {title}\n\
         - State: {state}\n\
         - Labels: {labels}\n\
         - Assignees: {assignees}\n\
         - URL: {url}\n\n\
         Issue Body:\n\
         {body}\n\n\
         Required markdown sections:\n\
         1. # Resolution Guidelines\n\
         2. ## Problem Summary\n\
         3. ## Scope and Constraints\n\
         4. ## Implementation Strategy\n\
         5. ## Risks and Edge Cases\n\
         6. ## Verification Checklist\n\
         7. ## Done Criteria\n\n\
         Keep it actionable for an autonomous coding agent. Be concrete about expected code changes and tests.",
        owner = backlog_item.owner,
        repo = backlog_item.repo,
        issue_number = backlog_item.issue_number,
        title = backlog_item.title,
        state = backlog_item.state,
        labels = labels,
        assignees = assignees,
        url = backlog_item.html_url,
        body = body,
    )
}

fn build_fallback_guidelines(backlog_item: &BacklogItem) -> String {
    let body = truncate_chars(
        backlog_item
            .body
            .as_deref()
            .unwrap_or("No issue body provided."),
        1200,
    );
    let labels = if backlog_item.labels.is_empty() {
        "none".to_string()
    } else {
        backlog_item.labels.join(", ")
    };

    format!(
        "# Resolution Guidelines\n\n\
         ## Problem Summary\n\
         - Repository: `{owner}/{repo}`\n\
         - Issue: `#{issue_number}`\n\
         - Title: {title}\n\
         - Labels: {labels}\n\
         - URL: {url}\n\n\
         ## Scope and Constraints\n\
         - Reproduce the issue before implementing a fix.\n\
         - Keep the change set focused on this issue and avoid unrelated refactors.\n\
         - Preserve existing behavior outside the affected path.\n\n\
         ## Implementation Strategy\n\
         1. Confirm expected behavior and current failure mode from issue details and code paths.\n\
         2. Identify the minimal set of files/components affected by the defect or feature gap.\n\
         3. Implement the fix with explicit handling for edge cases and invalid input.\n\
         4. Add or update tests that fail before the fix and pass after.\n\
         5. Validate locally and document assumptions in commit/PR notes.\n\n\
         ## Risks and Edge Cases\n\
         - Regression in adjacent flows that depend on the same code path.\n\
         - Incomplete handling of null/empty/invalid inputs.\n\
         - Missing integration coverage for command/API boundaries.\n\n\
         ## Verification Checklist\n\
         - [ ] Repro steps are captured.\n\
         - [ ] Fix implemented and code reviewed.\n\
         - [ ] Relevant unit/integration tests updated.\n\
         - [ ] All checks (lint/type/tests) pass.\n\
         - [ ] Manual verification done for main user flow.\n\n\
         ## Done Criteria\n\
         - Issue behavior is corrected.\n\
         - Tests cover the failure and success cases.\n\
         - No new warnings/errors introduced.\n\n\
         ## Issue Body Snapshot\n\
         {body}",
        owner = backlog_item.owner,
        repo = backlog_item.repo,
        issue_number = backlog_item.issue_number,
        title = backlog_item.title,
        labels = labels,
        url = backlog_item.html_url,
        body = body,
    )
}

fn normalize_markdown(markdown: &str) -> String {
    let trimmed = markdown.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.starts_with('#') {
        trimmed.to_string()
    } else {
        format!("# Resolution Guidelines\n\n{}", trimmed)
    }
}

async fn generate_resolution_guidelines(backlog_item: &BacklogItem) -> (String, bool) {
    let prompt = build_guidelines_prompt(backlog_item);
    let claude = ClaudeProvider::new();

    match claude.run_prompt(&prompt, None, Some(180)).await {
        Ok(output) => {
            let markdown = normalize_markdown(&output);
            if markdown.is_empty() {
                (build_fallback_guidelines(backlog_item), true)
            } else {
                (markdown, false)
            }
        }
        Err(_) => (build_fallback_guidelines(backlog_item), true),
    }
}

fn build_linked_workflow(backlog_item: &BacklogItem, guidelines_markdown: &str) -> Workflow {
    let now = chrono::Utc::now().to_rfc3339();
    let workflow_id = uuid::Uuid::new_v4().to_string();
    let workflow_name = build_workflow_name(backlog_item);

    let analysis_prompt = format!(
        "Review GitHub issue #{issue_number} from {owner}/{repo} and refine the resolution guidelines in markdown.\n\
         Use these initial guidelines as baseline context:\n\n{guidelines}",
        issue_number = backlog_item.issue_number,
        owner = backlog_item.owner,
        repo = backlog_item.repo,
        guidelines = guidelines_markdown,
    );

    Workflow {
        id: workflow_id,
        name: workflow_name,
        description: Some(format!(
            "Linked backlog issue #{issue_number} ({owner}/{repo})",
            issue_number = backlog_item.issue_number,
            owner = backlog_item.owner,
            repo = backlog_item.repo,
        )),
        status: "draft".to_string(),
        nodes: vec![
            WorkflowNode {
                id: "trigger-1".to_string(),
                node_type: "trigger".to_string(),
                config: Some(json!({
                    "trigger_type": "manual"
                })),
                inputs: None,
                position: Some(NodePosition { x: 120.0, y: 180.0 }),
            },
            WorkflowNode {
                id: "analyze-1".to_string(),
                node_type: "claude.analyze".to_string(),
                config: Some(json!({
                    "prompt": analysis_prompt,
                    "timeout_secs": 240
                })),
                inputs: None,
                position: Some(NodePosition { x: 420.0, y: 180.0 }),
            },
        ],
        edges: vec![WorkflowEdge {
            id: "edge-trigger-to-analyze".to_string(),
            source: "trigger-1".to_string(),
            target: "analyze-1".to_string(),
            source_handle: None,
            target_handle: None,
        }],
        config: Some(json!({
            "backlog": {
                "item_id": backlog_item.id.clone(),
                "owner": backlog_item.owner.clone(),
                "repo": backlog_item.repo.clone(),
                "issue_number": backlog_item.issue_number,
                "issue_url": backlog_item.html_url.clone(),
            },
            "resolution_guidelines_markdown": guidelines_markdown,
        })),
        schedule: None,
        version: 1,
        created_at: now.clone(),
        updated_at: now,
    }
}
