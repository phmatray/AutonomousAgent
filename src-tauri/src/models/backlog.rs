use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklogItem {
    pub id: String,
    pub owner: String,
    pub repo: String,
    pub issue_number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub html_url: String,
    pub linked_workflow_id: Option<String>,
    pub resolution_guidelines_md: Option<String>,
    pub triage_status: String,
    pub priority: String,
    pub effort: String,
    pub impact: String,
    pub rank: i64,
    pub synced_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BacklogFilters {
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub state: Option<String>,
    pub label: Option<String>,
    pub search: Option<String>,
    pub triage_status: Option<String>,
    pub priority: Option<String>,
    pub linked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BacklogTriageUpdate {
    pub triage_status: Option<String>,
    pub priority: Option<String>,
    pub effort: Option<String>,
    pub impact: Option<String>,
    pub rank: Option<i64>,
}
