pub mod schema;

use crate::errors::Result;
use sqlx::sqlite::SqlitePool;
use tauri::AppHandle;

pub async fn init_database(app: &AppHandle) -> Result<()> {
    let app_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_dir)?;

    let db_path = app_dir.join("autonomous_agent.db");
    let db_url = format!("sqlite:{}", db_path.display());

    let pool = SqlitePool::connect(&db_url).await?;

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

    Ok(())
}
