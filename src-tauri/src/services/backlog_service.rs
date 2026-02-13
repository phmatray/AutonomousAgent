use crate::errors::{AppError, Result};
use crate::models::backlog::{BacklogFilters, BacklogItem, BacklogTriageUpdate};
use crate::services::github_client::GithubIssue;

use sqlx::sqlite::SqlitePool;
use sqlx::{QueryBuilder, Sqlite};
use std::sync::Arc;
use tokio::sync::RwLock;

const TRIAGE_STATUSES: [&str; 5] = ["inbox", "ready", "in_progress", "blocked", "done"];
const PRIORITIES: [&str; 4] = ["low", "medium", "high", "critical"];
const EFFORT_LEVELS: [&str; 3] = ["small", "medium", "large"];
const IMPACT_LEVELS: [&str; 3] = ["low", "medium", "high"];

pub struct BacklogService {
    db_pool: Arc<RwLock<Option<SqlitePool>>>,
}

impl BacklogService {
    pub fn new(db_pool: Arc<RwLock<Option<SqlitePool>>>) -> Self {
        Self { db_pool }
    }

    async fn get_pool(&self) -> Result<SqlitePool> {
        self.db_pool
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Database {
                code: crate::errors::types::ErrorCode::DatabaseNotInitialized.as_str(),
                message: "Database not initialized".to_string(),
            })
    }

    pub async fn list_backlog_items(&self, filters: &BacklogFilters) -> Result<Vec<BacklogItem>> {
        let pool = self.get_pool().await?;

        let mut builder = QueryBuilder::<Sqlite>::new(
            "SELECT id, owner, repo, issue_number, title, body, state, labels, assignees, html_url, linked_workflow_id, resolution_guidelines_md, triage_status, priority, effort, impact, rank, synced_at, created_at, updated_at FROM backlog_items WHERE 1=1",
        );

        if let Some(owner) = &filters.owner {
            builder.push(" AND owner = ").push_bind(owner);
        }
        if let Some(repo) = &filters.repo {
            builder.push(" AND repo = ").push_bind(repo);
        }
        if let Some(state) = &filters.state {
            builder.push(" AND state = ").push_bind(state);
        }
        if let Some(label) = &filters.label {
            builder
                .push(" AND labels LIKE ")
                .push_bind(format!("%\"{}\"%", label));
        }
        if let Some(search) = &filters.search {
            let pattern = format!("%{}%", search);
            builder
                .push(" AND (title LIKE ")
                .push_bind(pattern.clone())
                .push(" OR body LIKE ")
                .push_bind(pattern)
                .push(")");
        }
        if let Some(triage_status) = &filters.triage_status {
            builder
                .push(" AND triage_status = ")
                .push_bind(triage_status.to_ascii_lowercase());
        }
        if let Some(priority) = &filters.priority {
            builder
                .push(" AND priority = ")
                .push_bind(priority.to_ascii_lowercase());
        }
        if let Some(linked) = filters.linked {
            if linked {
                builder.push(" AND linked_workflow_id IS NOT NULL");
            } else {
                builder.push(" AND linked_workflow_id IS NULL");
            }
        }

        builder.push(" ORDER BY rank DESC, issue_number ASC");

        let rows = builder
            .build_query_as::<BacklogItemRow>()
            .fetch_all(&pool)
            .await?;
        Ok(rows.into_iter().map(|r| r.into_backlog_item()).collect())
    }

    pub async fn get_backlog_item(&self, backlog_item_id: &str) -> Result<Option<BacklogItem>> {
        let pool = self.get_pool().await?;
        let row = sqlx::query_as::<_, BacklogItemRow>(
            "SELECT id, owner, repo, issue_number, title, body, state, labels, assignees, html_url, linked_workflow_id, resolution_guidelines_md, triage_status, priority, effort, impact, rank, synced_at, created_at, updated_at FROM backlog_items WHERE id = ?",
        )
        .bind(backlog_item_id)
        .fetch_optional(&pool)
        .await?;

        Ok(row.map(|r| r.into_backlog_item()))
    }

    pub async fn sync_issues_to_backlog(
        &self,
        owner: &str,
        repo: &str,
        issues: Vec<GithubIssue>,
    ) -> Result<Vec<BacklogItem>> {
        let pool = self.get_pool().await?;
        let now = chrono::Utc::now().to_rfc3339();

        for issue in &issues {
            let id = format!("{}/{}/{}", owner, repo, issue.number);
            let labels_json = serde_json::to_string(&issue.labels)?;
            let assignees_json = serde_json::to_string(&issue.assignees)?;
            let html_url = format!(
                "https://github.com/{}/{}/issues/{}",
                owner, repo, issue.number
            );

            sqlx::query(
                r#"INSERT INTO backlog_items (id, owner, repo, issue_number, title, body, state, labels, assignees, html_url, synced_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(owner, repo, issue_number) DO UPDATE SET
                    title = excluded.title,
                    body = excluded.body,
                    state = excluded.state,
                    labels = excluded.labels,
                    assignees = excluded.assignees,
                    synced_at = excluded.synced_at,
                    updated_at = excluded.updated_at"#,
            )
            .bind(&id)
            .bind(owner)
            .bind(repo)
            .bind(issue.number)
            .bind(&issue.title)
            .bind(&issue.body)
            .bind(&issue.state)
            .bind(&labels_json)
            .bind(&assignees_json)
            .bind(&html_url)
            .bind(&now)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await?;
        }

        let filters = BacklogFilters {
            owner: Some(owner.to_string()),
            repo: Some(repo.to_string()),
            ..Default::default()
        };
        self.list_backlog_items(&filters).await
    }

    pub async fn link_to_workflow(&self, backlog_item_id: &str, workflow_id: &str) -> Result<()> {
        let pool = self.get_pool().await?;
        let now = chrono::Utc::now().to_rfc3339();

        let result = sqlx::query(
            "UPDATE backlog_items SET linked_workflow_id = ?, updated_at = ? WHERE id = ?",
        )
        .bind(workflow_id)
        .bind(&now)
        .bind(backlog_item_id)
        .execute(&pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::Validation(format!(
                "Backlog item {} not found",
                backlog_item_id
            )));
        }
        Ok(())
    }

    pub async fn update_link_and_guidelines(
        &self,
        backlog_item_id: &str,
        workflow_id: &str,
        resolution_guidelines_md: &str,
    ) -> Result<BacklogItem> {
        let pool = self.get_pool().await?;
        let now = chrono::Utc::now().to_rfc3339();

        let result = sqlx::query(
            "UPDATE backlog_items SET linked_workflow_id = ?, resolution_guidelines_md = ?, updated_at = ? WHERE id = ?",
        )
        .bind(workflow_id)
        .bind(resolution_guidelines_md)
        .bind(&now)
        .bind(backlog_item_id)
        .execute(&pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::Validation(format!(
                "Backlog item {} not found",
                backlog_item_id
            )));
        }

        self.get_backlog_item(backlog_item_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation(format!("Backlog item {} not found", backlog_item_id))
            })
    }

    pub async fn update_backlog_triage(
        &self,
        backlog_item_id: &str,
        triage: &BacklogTriageUpdate,
    ) -> Result<BacklogItem> {
        let pool = self.get_pool().await?;
        let triage = sanitize_triage_update(triage)?;
        if triage.is_empty() {
            return self
                .get_backlog_item(backlog_item_id)
                .await?
                .ok_or_else(|| {
                    AppError::Validation(format!("Backlog item {} not found", backlog_item_id))
                });
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut builder = QueryBuilder::<Sqlite>::new("UPDATE backlog_items SET ");
        let mut separated = builder.separated(", ");

        if let Some(value) = &triage.triage_status {
            separated.push("triage_status = ").push_bind(value);
        }
        if let Some(value) = &triage.priority {
            separated.push("priority = ").push_bind(value);
        }
        if let Some(value) = &triage.effort {
            separated.push("effort = ").push_bind(value);
        }
        if let Some(value) = &triage.impact {
            separated.push("impact = ").push_bind(value);
        }
        if let Some(value) = triage.rank {
            separated.push("rank = ").push_bind(value);
        }
        separated.push("updated_at = ").push_bind(&now);

        builder.push(" WHERE id = ").push_bind(backlog_item_id);

        let result = builder.build().execute(&pool).await?;
        if result.rows_affected() == 0 {
            return Err(AppError::Validation(format!(
                "Backlog item {} not found",
                backlog_item_id
            )));
        }

        self.get_backlog_item(backlog_item_id)
            .await?
            .ok_or_else(|| {
                AppError::Validation(format!("Backlog item {} not found", backlog_item_id))
            })
    }

    pub async fn bulk_update_backlog_triage(
        &self,
        ids: &[String],
        triage: &BacklogTriageUpdate,
    ) -> Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }

        let pool = self.get_pool().await?;
        let triage = sanitize_triage_update(triage)?;
        if triage.is_empty() {
            return Ok(0);
        }

        let now = chrono::Utc::now().to_rfc3339();
        let mut builder = QueryBuilder::<Sqlite>::new("UPDATE backlog_items SET ");
        let mut separated = builder.separated(", ");

        if let Some(value) = &triage.triage_status {
            separated.push("triage_status = ").push_bind(value);
        }
        if let Some(value) = &triage.priority {
            separated.push("priority = ").push_bind(value);
        }
        if let Some(value) = &triage.effort {
            separated.push("effort = ").push_bind(value);
        }
        if let Some(value) = &triage.impact {
            separated.push("impact = ").push_bind(value);
        }
        if let Some(value) = triage.rank {
            separated.push("rank = ").push_bind(value);
        }
        separated.push("updated_at = ").push_bind(&now);

        builder.push(" WHERE id IN (");
        let mut id_list = builder.separated(", ");
        for id in ids {
            id_list.push_bind(id);
        }
        builder.push(")");

        let result = builder.build().execute(&pool).await?;
        Ok(result.rows_affected())
    }

    pub async fn delete_backlog_item(&self, id: &str) -> Result<()> {
        let pool = self.get_pool().await?;

        let result = sqlx::query("DELETE FROM backlog_items WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(AppError::Validation(format!(
                "Backlog item {} not found",
                id
            )));
        }
        Ok(())
    }

    pub async fn delete_backlog_items(&self, ids: &[String]) -> Result<u64> {
        if ids.is_empty() {
            return Ok(0);
        }

        let pool = self.get_pool().await?;
        let mut builder = QueryBuilder::<Sqlite>::new("DELETE FROM backlog_items WHERE id IN (");
        let mut separated = builder.separated(", ");
        for id in ids {
            separated.push_bind(id);
        }
        builder.push(")");

        let result = builder.build().execute(&pool).await?;
        Ok(result.rows_affected())
    }
}

#[derive(Default)]
struct SanitizedTriageUpdate {
    triage_status: Option<String>,
    priority: Option<String>,
    effort: Option<String>,
    impact: Option<String>,
    rank: Option<i64>,
}

impl SanitizedTriageUpdate {
    fn is_empty(&self) -> bool {
        self.triage_status.is_none()
            && self.priority.is_none()
            && self.effort.is_none()
            && self.impact.is_none()
            && self.rank.is_none()
    }
}

fn sanitize_choice(
    value: Option<&String>,
    allowed: &[&str],
    field: &str,
) -> Result<Option<String>> {
    let Some(raw) = value else {
        return Ok(None);
    };

    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Ok(None);
    }

    if allowed.iter().any(|candidate| *candidate == normalized) {
        Ok(Some(normalized))
    } else {
        Err(AppError::Validation(format!(
            "Invalid {} value '{}'. Allowed: {}",
            field,
            raw,
            allowed.join(", ")
        )))
    }
}

fn sanitize_triage_update(update: &BacklogTriageUpdate) -> Result<SanitizedTriageUpdate> {
    Ok(SanitizedTriageUpdate {
        triage_status: sanitize_choice(
            update.triage_status.as_ref(),
            &TRIAGE_STATUSES,
            "triage status",
        )?,
        priority: sanitize_choice(update.priority.as_ref(), &PRIORITIES, "priority")?,
        effort: sanitize_choice(update.effort.as_ref(), &EFFORT_LEVELS, "effort")?,
        impact: sanitize_choice(update.impact.as_ref(), &IMPACT_LEVELS, "impact")?,
        rank: update.rank,
    })
}

// ----- SQLx row type -----

#[derive(sqlx::FromRow)]
struct BacklogItemRow {
    id: String,
    owner: String,
    repo: String,
    issue_number: i64,
    title: String,
    body: Option<String>,
    state: String,
    labels: String,
    assignees: String,
    html_url: String,
    linked_workflow_id: Option<String>,
    resolution_guidelines_md: Option<String>,
    triage_status: String,
    priority: String,
    effort: String,
    impact: String,
    rank: i64,
    synced_at: String,
    created_at: String,
    updated_at: String,
}

impl BacklogItemRow {
    fn into_backlog_item(self) -> BacklogItem {
        let labels: Vec<String> = serde_json::from_str(&self.labels).unwrap_or_default();
        let assignees: Vec<String> = serde_json::from_str(&self.assignees).unwrap_or_default();

        BacklogItem {
            id: self.id,
            owner: self.owner,
            repo: self.repo,
            issue_number: self.issue_number,
            title: self.title,
            body: self.body,
            state: self.state,
            labels,
            assignees,
            html_url: self.html_url,
            linked_workflow_id: self.linked_workflow_id,
            resolution_guidelines_md: self.resolution_guidelines_md,
            triage_status: self.triage_status,
            priority: self.priority,
            effort: self.effort,
            impact: self.impact,
            rank: self.rank,
            synced_at: self.synced_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}
