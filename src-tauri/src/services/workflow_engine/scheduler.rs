use crate::errors::{AppError, Result};
use crate::models::workflow::Workflow;
use chrono::{DateTime, Utc};
use cron::Schedule;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use std::str::FromStr;

/// Describes when a workflow should be triggered.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TriggerConfig {
    /// Triggered manually via the UI or API.
    Manual,
    /// Triggered on a cron schedule (e.g. "0 */6 * * *").
    Cron {
        expression: String,
        timezone: String,
    },
    /// Triggered by an external webhook.
    Webhook { path: String },
    /// Triggered when the workflow returns to IDLE state.
    StateIdle,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ScheduledWorkflow {
    pub workflow_id: String,
    pub cron_expression: Option<String>,
}

/// Durable scheduler persisted in SQLite.
pub struct Scheduler;

impl Scheduler {
    pub fn new() -> Self {
        Self
    }

    pub fn trigger_from_workflow(workflow: &Workflow) -> Option<TriggerConfig> {
        let trigger_node = workflow
            .nodes
            .iter()
            .find(|node| node.node_type == "trigger.cron" || node.node_type == "trigger")?;

        let config = trigger_node.config.as_ref();
        if trigger_node.node_type == "trigger.cron" {
            let expression = config
                .and_then(|value| value.get("schedule"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)?;
            let timezone = config
                .and_then(|value| value.get("timezone"))
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("UTC")
                .to_string();
            return Some(TriggerConfig::Cron {
                expression,
                timezone,
            });
        }

        let trigger_type = config
            .and_then(|value| value.get("trigger_type"))
            .and_then(|value| value.as_str())
            .unwrap_or("manual")
            .trim()
            .to_ascii_lowercase();

        match trigger_type.as_str() {
            "state" | "state_idle" => Some(TriggerConfig::StateIdle),
            "webhook" => {
                let path = config
                    .and_then(|value| value.get("path"))
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("/workflow-webhook")
                    .to_string();
                Some(TriggerConfig::Webhook { path })
            }
            _ => Some(TriggerConfig::Manual),
        }
    }

    pub async fn sync_workflow_schedule(
        &self,
        pool: &SqlitePool,
        workflow: &Workflow,
    ) -> Result<()> {
        let Some(trigger) = Self::trigger_from_workflow(workflow) else {
            return self.remove_workflow_schedule(pool, &workflow.id).await;
        };

        match trigger {
            TriggerConfig::Manual => self.remove_workflow_schedule(pool, &workflow.id).await,
            TriggerConfig::Cron {
                expression,
                timezone,
            } => {
                let now = Utc::now();
                let next_run_at = Self::next_run_at(&expression, now)?;
                sqlx::query(
                    "INSERT INTO workflow_schedules (workflow_id, trigger_type, cron_expression, timezone, enabled, last_run_at, next_run_at, updated_at)
                     VALUES (?, 'cron', ?, ?, 1, NULL, ?, ?)
                     ON CONFLICT(workflow_id) DO UPDATE SET
                       trigger_type = excluded.trigger_type,
                       cron_expression = excluded.cron_expression,
                       timezone = excluded.timezone,
                       enabled = excluded.enabled,
                       next_run_at = excluded.next_run_at,
                       updated_at = excluded.updated_at",
                )
                .bind(&workflow.id)
                .bind(&expression)
                .bind(&timezone)
                .bind(next_run_at)
                .bind(now.to_rfc3339())
                .execute(pool)
                .await?;
                Ok(())
            }
            TriggerConfig::Webhook { path } => {
                let now = Utc::now().to_rfc3339();
                sqlx::query(
                    "INSERT INTO workflow_schedules (workflow_id, trigger_type, cron_expression, timezone, enabled, last_run_at, next_run_at, updated_at)
                     VALUES (?, 'webhook', ?, NULL, 1, NULL, NULL, ?)
                     ON CONFLICT(workflow_id) DO UPDATE SET
                       trigger_type = excluded.trigger_type,
                       cron_expression = excluded.cron_expression,
                       timezone = excluded.timezone,
                       enabled = excluded.enabled,
                       next_run_at = excluded.next_run_at,
                       updated_at = excluded.updated_at",
                )
                .bind(&workflow.id)
                .bind(path)
                .bind(now)
                .execute(pool)
                .await?;
                Ok(())
            }
            TriggerConfig::StateIdle => {
                let now = Utc::now().to_rfc3339();
                sqlx::query(
                    "INSERT INTO workflow_schedules (workflow_id, trigger_type, cron_expression, timezone, enabled, last_run_at, next_run_at, updated_at)
                     VALUES (?, 'state_idle', NULL, NULL, 1, NULL, NULL, ?)
                     ON CONFLICT(workflow_id) DO UPDATE SET
                       trigger_type = excluded.trigger_type,
                       cron_expression = excluded.cron_expression,
                       timezone = excluded.timezone,
                       enabled = excluded.enabled,
                       next_run_at = excluded.next_run_at,
                       updated_at = excluded.updated_at",
                )
                .bind(&workflow.id)
                .bind(now)
                .execute(pool)
                .await?;
                Ok(())
            }
        }
    }

    pub async fn remove_workflow_schedule(
        &self,
        pool: &SqlitePool,
        workflow_id: &str,
    ) -> Result<()> {
        sqlx::query("DELETE FROM workflow_schedules WHERE workflow_id = ?")
            .bind(workflow_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn due_cron_workflows(
        &self,
        pool: &SqlitePool,
        now: DateTime<Utc>,
    ) -> Result<Vec<ScheduledWorkflow>> {
        let now_iso = now.to_rfc3339();
        let rows = sqlx::query_as::<_, ScheduledWorkflow>(
            "SELECT workflow_id, cron_expression
             FROM workflow_schedules
             WHERE enabled = 1
               AND trigger_type = 'cron'
               AND next_run_at IS NOT NULL
               AND next_run_at <= ?
             ORDER BY next_run_at ASC",
        )
        .bind(now_iso)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    pub async fn mark_cron_executed(
        &self,
        pool: &SqlitePool,
        workflow_id: &str,
        expression: &str,
        executed_at: DateTime<Utc>,
    ) -> Result<()> {
        let next_run_at = Self::next_run_at(expression, executed_at)?;
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE workflow_schedules
             SET last_run_at = ?, next_run_at = ?, updated_at = ?
             WHERE workflow_id = ?",
        )
        .bind(executed_at.to_rfc3339())
        .bind(next_run_at)
        .bind(now)
        .bind(workflow_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    fn next_run_at(expression: &str, from: DateTime<Utc>) -> Result<Option<String>> {
        let schedule = Schedule::from_str(expression).map_err(|error| {
            AppError::Validation(format!(
                "Invalid cron expression '{}': {}",
                expression, error
            ))
        })?;
        Ok(schedule.after(&from).next().map(|date| date.to_rfc3339()))
    }
}
