use crate::errors::{AppError, Result};
use crate::models::backlog::{BacklogFilters, BacklogItem};
use crate::services::github_client::GithubIssue;

use sqlx::sqlite::SqlitePool;
use std::sync::Arc;
use tokio::sync::RwLock;

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

        let mut query = String::from(
            "SELECT id, owner, repo, issue_number, title, body, state, labels, assignees, html_url, linked_workflow_id, resolution_guidelines_md, synced_at, created_at, updated_at FROM backlog_items WHERE 1=1",
        );
        let mut binds: Vec<String> = Vec::new();

        if let Some(owner) = &filters.owner {
            query.push_str(" AND owner = ?");
            binds.push(owner.clone());
        }
        if let Some(repo) = &filters.repo {
            query.push_str(" AND repo = ?");
            binds.push(repo.clone());
        }
        if let Some(state) = &filters.state {
            query.push_str(" AND state = ?");
            binds.push(state.clone());
        }
        if let Some(label) = &filters.label {
            query.push_str(" AND labels LIKE ?");
            binds.push(format!("%\"{}\"%", label));
        }
        if let Some(search) = &filters.search {
            query.push_str(" AND (title LIKE ? OR body LIKE ?)");
            let pattern = format!("%{}%", search);
            binds.push(pattern.clone());
            binds.push(pattern);
        }

        query.push_str(" ORDER BY issue_number ASC");

        let mut sqlx_query = sqlx::query_as::<_, BacklogItemRow>(&query);
        for bind in &binds {
            sqlx_query = sqlx_query.bind(bind);
        }

        let rows = sqlx_query.fetch_all(&pool).await?;
        Ok(rows.into_iter().map(|r| r.into_backlog_item()).collect())
    }

    pub async fn get_backlog_item(&self, backlog_item_id: &str) -> Result<Option<BacklogItem>> {
        let pool = self.get_pool().await?;
        let row = sqlx::query_as::<_, BacklogItemRow>(
            "SELECT id, owner, repo, issue_number, title, body, state, labels, assignees, html_url, linked_workflow_id, resolution_guidelines_md, synced_at, created_at, updated_at FROM backlog_items WHERE id = ?",
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

        // Return the synced items
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
            synced_at: self.synced_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}
