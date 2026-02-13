pub mod schema;

use crate::errors::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool};
use sqlx::Row;
use std::str::FromStr;
use tauri::{AppHandle, Manager};

pub async fn init_database(app: &AppHandle) -> Result<SqlitePool> {
    let app_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("autonomous_agent.db");
    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

    let options = SqliteConnectOptions::from_str(&db_url)?.create_if_missing(true);
    let pool = SqlitePool::connect_with(options).await?;

    // Run migrations
    sqlx::query(schema::CREATE_WORKFLOWS_TABLE)
        .execute(&pool)
        .await?;
    sqlx::query(schema::CREATE_EXECUTIONS_TABLE)
        .execute(&pool)
        .await?;
    sqlx::query(schema::CREATE_EXECUTION_LOGS_TABLE)
        .execute(&pool)
        .await?;
    sqlx::query(schema::CREATE_NODE_EXECUTIONS_TABLE)
        .execute(&pool)
        .await?;
    sqlx::query(schema::CREATE_CONFIG_TABLE)
        .execute(&pool)
        .await?;
    sqlx::query(schema::CREATE_BACKLOG_ITEMS_TABLE)
        .execute(&pool)
        .await?;
    sqlx::query(schema::CREATE_SCHEMA_VERSION_TABLE)
        .execute(&pool)
        .await?;
    ensure_workflow_status_column(&pool).await?;

    // Create indexes for performance
    sqlx::query(schema::CREATE_INDEXES).execute(&pool).await?;

    // Record current schema version
    sqlx::query("INSERT OR IGNORE INTO schema_version (version) VALUES (1)")
        .execute(&pool)
        .await?;

    Ok(pool)
}

async fn ensure_workflow_status_column(pool: &SqlitePool) -> Result<()> {
    let columns = sqlx::query("PRAGMA table_info(workflows)")
        .fetch_all(pool)
        .await?;
    let has_status = columns
        .iter()
        .any(|row| row.get::<String, _>("name").eq_ignore_ascii_case("status"));
    if !has_status {
        sqlx::query("ALTER TABLE workflows ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'")
            .execute(pool)
            .await?;
    }

    Ok(())
}
