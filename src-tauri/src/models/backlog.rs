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
}
