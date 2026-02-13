use chrono::Utc;
use serde_json::{json, Value};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Schema DDL (mirrors src-tauri/src/db/schema.rs)
// ---------------------------------------------------------------------------

const CREATE_WORKFLOWS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    nodes TEXT NOT NULL,
    edges TEXT NOT NULL,
    config TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
"#;

const CREATE_EXECUTIONS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger_type TEXT,
    started_at TEXT,
    completed_at TEXT,
    error TEXT,
    context TEXT,
    current_node_id TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id)
)
"#;

const CREATE_EXECUTION_LOGS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL,
    node_id TEXT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (execution_id) REFERENCES executions(id)
)
"#;

const CREATE_NODE_EXECUTIONS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS node_executions (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL,
    input TEXT,
    output TEXT,
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    retry_count INTEGER DEFAULT 0,
    FOREIGN KEY (execution_id) REFERENCES executions(id)
)
"#;

const CREATE_CONFIG_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT FALSE,
    updated_at TEXT NOT NULL
)
"#;

const CREATE_BACKLOG_ITEMS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS backlog_items (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    state TEXT NOT NULL,
    labels TEXT NOT NULL DEFAULT '[]',
    assignees TEXT NOT NULL DEFAULT '[]',
    html_url TEXT NOT NULL,
    linked_workflow_id TEXT,
    synced_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner, repo, issue_number),
    FOREIGN KEY (linked_workflow_id) REFERENCES workflows(id)
)
"#;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePool::connect(":memory:").await.unwrap();

    // Enable foreign key enforcement (off by default in SQLite)
    sqlx::query("PRAGMA foreign_keys = ON")
        .execute(&pool)
        .await
        .unwrap();

    sqlx::query(CREATE_WORKFLOWS_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(CREATE_EXECUTIONS_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(CREATE_EXECUTION_LOGS_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(CREATE_NODE_EXECUTIONS_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(CREATE_CONFIG_TABLE)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(CREATE_BACKLOG_ITEMS_TABLE)
        .execute(&pool)
        .await
        .unwrap();

    pool
}

fn sample_nodes_json() -> String {
    serde_json::to_string(&json!([
        {
            "id": "trigger-1",
            "type": "trigger",
            "config": null,
            "inputs": null,
            "position": {"x": 100.0, "y": 200.0}
        },
        {
            "id": "sync-1",
            "type": "github.sync",
            "config": {"repo": "owner/repo"},
            "inputs": null,
            "position": {"x": 300.0, "y": 200.0}
        }
    ]))
    .unwrap()
}

fn sample_edges_json() -> String {
    serde_json::to_string(&json!([
        {
            "id": "edge-1",
            "source": "trigger-1",
            "target": "sync-1",
            "source_handle": null,
            "target_handle": null
        }
    ]))
    .unwrap()
}

async fn insert_workflow(pool: &SqlitePool, id: &str, name: &str) {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO workflows (id, name, description, nodes, edges, config, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind("A test workflow")
    .bind(sample_nodes_json())
    .bind(sample_edges_json())
    .bind(None::<String>)
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_execution(pool: &SqlitePool, exec_id: &str, workflow_id: &str) {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO executions (id, workflow_id, status, trigger_type, started_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(exec_id)
    .bind(workflow_id)
    .bind("RUNNING")
    .bind("manual")
    .bind(&now)
    .execute(pool)
    .await
    .unwrap();
}

// ===========================================================================
// Tests
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Schema migrations run successfully
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_schema_migrations_run_successfully() {
    let pool = setup_test_db().await;

    // Verify all expected tables exist by querying sqlite_master
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert!(
        tables.contains(&"workflows".to_string()),
        "workflows table missing"
    );
    assert!(
        tables.contains(&"executions".to_string()),
        "executions table missing"
    );
    assert!(
        tables.contains(&"execution_logs".to_string()),
        "execution_logs table missing"
    );
    assert!(
        tables.contains(&"node_executions".to_string()),
        "node_executions table missing"
    );
    assert!(
        tables.contains(&"config".to_string()),
        "config table missing"
    );
    assert!(
        tables.contains(&"backlog_items".to_string()),
        "backlog_items table missing"
    );
}

#[tokio::test]
async fn test_schema_is_idempotent() {
    // Running schema creation twice should not fail
    let pool = SqlitePool::connect(":memory:").await.unwrap();

    for _ in 0..2 {
        sqlx::query(CREATE_WORKFLOWS_TABLE)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(CREATE_EXECUTIONS_TABLE)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(CREATE_EXECUTION_LOGS_TABLE)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(CREATE_NODE_EXECUTIONS_TABLE)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(CREATE_CONFIG_TABLE)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(CREATE_BACKLOG_ITEMS_TABLE)
            .execute(&pool)
            .await
            .unwrap();
    }
}

// ---------------------------------------------------------------------------
// 2. CRUD operations for workflows table
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_workflow_create() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &id, "Test Workflow").await;

    let row = sqlx::query("SELECT id, name FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.get::<String, _>("id"), id);
    assert_eq!(row.get::<String, _>("name"), "Test Workflow");
}

#[tokio::test]
async fn test_workflow_read() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &id, "Read Test").await;

    let row = sqlx::query(
        "SELECT id, name, description, nodes, edges, config, version, created_at, updated_at FROM workflows WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.get::<String, _>("name"), "Read Test");
    assert_eq!(
        row.get::<Option<String>, _>("description"),
        Some("A test workflow".into())
    );
    assert_eq!(row.get::<i32, _>("version"), 1);
    // created_at / updated_at should be non-empty
    assert!(!row.get::<String, _>("created_at").is_empty());
}

#[tokio::test]
async fn test_workflow_update() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &id, "Original Name").await;

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE workflows SET name = ?, version = version + 1, updated_at = ? WHERE id = ?",
    )
    .bind("Updated Name")
    .bind(&now)
    .bind(&id)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT name, version FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.get::<String, _>("name"), "Updated Name");
    assert_eq!(row.get::<i32, _>("version"), 2);
}

#[tokio::test]
async fn test_workflow_delete() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &id, "To Delete").await;

    sqlx::query("DELETE FROM workflows WHERE id = ?")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();

    let row = sqlx::query("SELECT id FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_optional(&pool)
        .await
        .unwrap();

    assert!(row.is_none());
}

#[tokio::test]
async fn test_workflow_list() {
    let pool = setup_test_db().await;

    for i in 0..3 {
        let id = Uuid::new_v4().to_string();
        insert_workflow(&pool, &id, &format!("Workflow {}", i)).await;
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 3);
}

#[tokio::test]
async fn test_workflow_duplicate_id_rejected() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &id, "First").await;

    // Inserting with the same primary key should fail
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("Duplicate")
    .bind("[]")
    .bind("[]")
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await;

    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 3. Foreign key cascade / referential integrity
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_execution_references_workflow() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "Parent WF").await;

    let exec_id = Uuid::new_v4().to_string();
    insert_execution(&pool, &exec_id, &wf_id).await;

    let row = sqlx::query("SELECT id, workflow_id, status FROM executions WHERE id = ?")
        .bind(&exec_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.get::<String, _>("workflow_id"), wf_id);
    assert_eq!(row.get::<String, _>("status"), "RUNNING");
}

#[tokio::test]
async fn test_execution_with_invalid_workflow_fails() {
    let pool = setup_test_db().await;

    // Attempt to insert an execution referencing a non-existent workflow
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO executions (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind("nonexistent-workflow")
    .bind("RUNNING")
    .bind(&now)
    .execute(&pool)
    .await;

    assert!(result.is_err(), "Should fail due to FK constraint");
}

#[tokio::test]
async fn test_node_execution_references_execution() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "WF").await;

    let exec_id = Uuid::new_v4().to_string();
    insert_execution(&pool, &exec_id, &wf_id).await;

    let node_exec_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO node_executions (id, execution_id, node_id, status, started_at, completed_at, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&node_exec_id)
    .bind(&exec_id)
    .bind("trigger-1")
    .bind("COMPLETED")
    .bind(&now)
    .bind(&now)
    .bind(0)
    .execute(&pool)
    .await
    .unwrap();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM node_executions WHERE execution_id = ?")
            .bind(&exec_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_node_execution_with_invalid_execution_fails() {
    let pool = setup_test_db().await;

    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO node_executions (id, execution_id, node_id, status, started_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind("nonexistent-execution")
    .bind("node-1")
    .bind("RUNNING")
    .bind(&now)
    .execute(&pool)
    .await;

    assert!(
        result.is_err(),
        "Should fail due to FK constraint on execution_id"
    );
}

#[tokio::test]
async fn test_execution_log_references_execution() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "WF").await;

    let exec_id = Uuid::new_v4().to_string();
    insert_execution(&pool, &exec_id, &wf_id).await;

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO execution_logs (execution_id, node_id, level, message, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&exec_id)
    .bind("trigger-1")
    .bind("INFO")
    .bind("Node started")
    .bind(None::<String>)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM execution_logs WHERE execution_id = ?")
            .bind(&exec_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_execution_log_with_invalid_execution_fails() {
    let pool = setup_test_db().await;

    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO execution_logs (execution_id, level, message, timestamp) VALUES (?, ?, ?, ?)",
    )
    .bind("nonexistent-execution")
    .bind("INFO")
    .bind("test")
    .bind(&now)
    .execute(&pool)
    .await;

    assert!(
        result.is_err(),
        "Should fail due to FK constraint on execution_id"
    );
}

#[tokio::test]
async fn test_backlog_item_fk_to_workflow() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "WF").await;

    let now = Utc::now().to_rfc3339();
    // Insert a backlog item linked to the workflow
    sqlx::query(
        "INSERT INTO backlog_items (id, owner, repo, issue_number, title, state, labels, assignees, html_url, linked_workflow_id, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("owner/repo/1")
    .bind("owner")
    .bind("repo")
    .bind(1)
    .bind("Issue title")
    .bind("open")
    .bind("[]")
    .bind("[]")
    .bind("https://github.com/owner/repo/issues/1")
    .bind(&wf_id)
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT linked_workflow_id FROM backlog_items WHERE id = ?")
        .bind("owner/repo/1")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        row.get::<Option<String>, _>("linked_workflow_id"),
        Some(wf_id)
    );
}

#[tokio::test]
async fn test_backlog_item_with_invalid_workflow_fk_fails() {
    let pool = setup_test_db().await;

    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO backlog_items (id, owner, repo, issue_number, title, state, labels, assignees, html_url, linked_workflow_id, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("owner/repo/99")
    .bind("owner")
    .bind("repo")
    .bind(99)
    .bind("Issue title")
    .bind("open")
    .bind("[]")
    .bind("[]")
    .bind("https://github.com/owner/repo/issues/99")
    .bind("nonexistent-workflow")
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await;

    assert!(
        result.is_err(),
        "Should fail due to FK constraint on linked_workflow_id"
    );
}

// ---------------------------------------------------------------------------
// 4. JSON serialization / deserialization for nodes, edges, config
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_json_nodes_roundtrip() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();

    let nodes = json!([
        {
            "id": "trigger-1",
            "type": "trigger",
            "config": null,
            "inputs": null,
            "position": {"x": 100.0, "y": 200.0}
        },
        {
            "id": "plan-1",
            "type": "claude.plan",
            "config": {"prompt": "Plan the implementation"},
            "inputs": null,
            "position": {"x": 500.0, "y": 200.0}
        }
    ]);

    let now = Utc::now().to_rfc3339();
    let nodes_str = serde_json::to_string(&nodes).unwrap();

    sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("JSON Test")
    .bind(&nodes_str)
    .bind("[]")
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT nodes FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let stored_nodes_str = row.get::<String, _>("nodes");
    let deserialized: Value = serde_json::from_str(&stored_nodes_str).unwrap();

    assert_eq!(deserialized, nodes);
    assert_eq!(deserialized[0]["id"], "trigger-1");
    assert_eq!(
        deserialized[1]["config"]["prompt"],
        "Plan the implementation"
    );
}

#[tokio::test]
async fn test_json_edges_roundtrip() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();

    let edges = json!([
        {
            "id": "e1",
            "source": "trigger-1",
            "target": "sync-1",
            "source_handle": "default",
            "target_handle": null
        },
        {
            "id": "e2",
            "source": "sync-1",
            "target": "plan-1",
            "source_handle": null,
            "target_handle": null
        }
    ]);

    let now = Utc::now().to_rfc3339();
    let edges_str = serde_json::to_string(&edges).unwrap();

    sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("Edge JSON Test")
    .bind("[]")
    .bind(&edges_str)
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT edges FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let deserialized: Value = serde_json::from_str(&row.get::<String, _>("edges")).unwrap();
    assert_eq!(deserialized, edges);
    assert_eq!(deserialized[0]["source"], "trigger-1");
    assert_eq!(deserialized[1]["target"], "plan-1");
}

#[tokio::test]
async fn test_json_config_roundtrip() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();

    let config = json!({
        "repo_url": "https://github.com/owner/repo",
        "max_retries": 3,
        "auto_merge": true,
        "labels": ["bug", "priority-high"]
    });

    let now = Utc::now().to_rfc3339();
    let config_str = serde_json::to_string(&config).unwrap();

    sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, config, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("Config JSON Test")
    .bind("[]")
    .bind("[]")
    .bind(&config_str)
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT config FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let stored: Value =
        serde_json::from_str(&row.get::<Option<String>, _>("config").unwrap()).unwrap();
    assert_eq!(stored, config);
    assert_eq!(stored["max_retries"], 3);
    assert_eq!(stored["labels"][0], "bug");
}

#[tokio::test]
async fn test_json_null_config() {
    let pool = setup_test_db().await;
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, config, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("Null Config")
    .bind("[]")
    .bind("[]")
    .bind(None::<String>)
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT config FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert!(row.get::<Option<String>, _>("config").is_none());
}

#[tokio::test]
async fn test_json_node_execution_output_roundtrip() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "WF").await;

    let exec_id = Uuid::new_v4().to_string();
    insert_execution(&pool, &exec_id, &wf_id).await;

    let output = json!({
        "repo": "owner/repo",
        "branch": "feature/fix-123",
        "files_changed": ["src/main.rs", "src/lib.rs"]
    });
    let output_str = serde_json::to_string(&output).unwrap();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO node_executions (id, execution_id, node_id, status, output, started_at, completed_at, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&exec_id)
    .bind("sync-1")
    .bind("COMPLETED")
    .bind(&output_str)
    .bind(&now)
    .bind(&now)
    .bind(0)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT output FROM node_executions WHERE execution_id = ?")
        .bind(&exec_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let stored: Value =
        serde_json::from_str(&row.get::<Option<String>, _>("output").unwrap()).unwrap();
    assert_eq!(stored, output);
    assert_eq!(stored["files_changed"][0], "src/main.rs");
}

#[tokio::test]
async fn test_json_execution_log_metadata_roundtrip() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "WF").await;

    let exec_id = Uuid::new_v4().to_string();
    insert_execution(&pool, &exec_id, &wf_id).await;

    let metadata = json!({
        "duration_ms": 1500,
        "retries": 0,
        "node_type": "github.sync"
    });
    let metadata_str = serde_json::to_string(&metadata).unwrap();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO execution_logs (execution_id, node_id, level, message, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&exec_id)
    .bind("sync-1")
    .bind("INFO")
    .bind("Sync completed")
    .bind(&metadata_str)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query("SELECT metadata FROM execution_logs WHERE execution_id = ?")
        .bind(&exec_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let stored: Value =
        serde_json::from_str(&row.get::<Option<String>, _>("metadata").unwrap()).unwrap();
    assert_eq!(stored, metadata);
    assert_eq!(stored["duration_ms"], 1500);
}

// ---------------------------------------------------------------------------
// 5. Concurrent access to database pool
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_concurrent_inserts() {
    let pool = setup_test_db().await;

    let mut handles = Vec::new();
    for i in 0..10 {
        let pool = pool.clone();
        handles.push(tokio::spawn(async move {
            let id = format!("concurrent-{}", i);
            let now = Utc::now().to_rfc3339();
            sqlx::query(
                "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(format!("WF {}", i))
            .bind("[]")
            .bind("[]")
            .bind(1)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();
        }));
    }

    for handle in handles {
        handle.await.unwrap();
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 10);
}

#[tokio::test]
async fn test_concurrent_reads_and_writes() {
    let pool = setup_test_db().await;

    // Pre-populate some data
    for i in 0..5 {
        let id = format!("rw-{}", i);
        insert_workflow(&pool, &id, &format!("WF {}", i)).await;
    }

    let mut handles = Vec::new();

    // Spawn concurrent readers
    for _ in 0..5 {
        let pool = pool.clone();
        handles.push(tokio::spawn(async move {
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert!(count >= 5);
        }));
    }

    // Spawn concurrent writers
    for i in 5..10 {
        let pool = pool.clone();
        handles.push(tokio::spawn(async move {
            let id = format!("rw-{}", i);
            let now = Utc::now().to_rfc3339();
            sqlx::query(
                "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(format!("WF {}", i))
            .bind("[]")
            .bind("[]")
            .bind(1)
            .bind(&now)
            .bind(&now)
            .execute(&pool)
            .await
            .unwrap();
        }));
    }

    for handle in handles {
        handle.await.unwrap();
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 10);
}

#[tokio::test]
async fn test_pool_shared_across_tasks() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "Shared WF").await;

    // Multiple tasks reading the same workflow concurrently
    let mut handles = Vec::new();
    for _ in 0..20 {
        let pool = pool.clone();
        let wf_id = wf_id.clone();
        handles.push(tokio::spawn(async move {
            let row = sqlx::query("SELECT name FROM workflows WHERE id = ?")
                .bind(&wf_id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("name"), "Shared WF");
        }));
    }

    for handle in handles {
        handle.await.unwrap();
    }
}

// ---------------------------------------------------------------------------
// 6. Transaction rollback on errors
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_transaction_commit() {
    let pool = setup_test_db().await;

    let mut tx = pool.begin().await.unwrap();

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("TX Workflow")
    .bind("[]")
    .bind("[]")
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.commit().await.unwrap();

    // Should be visible after commit
    let row = sqlx::query("SELECT name FROM workflows WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("name"), "TX Workflow");
}

#[tokio::test]
async fn test_transaction_rollback_on_drop() {
    let pool = setup_test_db().await;

    {
        let mut tx = pool.begin().await.unwrap();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind("Should Not Persist")
        .bind("[]")
        .bind("[]")
        .bind(1)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();

        // Transaction is dropped without commit -> implicit rollback
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, 0, "Rolled-back transaction should leave no rows");
}

#[tokio::test]
async fn test_transaction_explicit_rollback() {
    let pool = setup_test_db().await;

    let mut tx = pool.begin().await.unwrap();

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind("Rollback Me")
    .bind("[]")
    .bind("[]")
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .unwrap();

    tx.rollback().await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 0,
        "Explicitly rolled-back transaction should leave no rows"
    );
}

#[tokio::test]
async fn test_transaction_rollback_on_constraint_error() {
    let pool = setup_test_db().await;

    // Insert a workflow first
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "Existing").await;

    let mut tx = pool.begin().await.unwrap();

    // First insert succeeds within transaction
    let new_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&new_id)
    .bind("New WF in TX")
    .bind("[]")
    .bind("[]")
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await
    .unwrap();

    // Second insert fails (duplicate primary key)
    let dup_result = sqlx::query(
        "INSERT INTO workflows (id, name, nodes, edges, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&wf_id) // duplicate
    .bind("Duplicate WF")
    .bind("[]")
    .bind("[]")
    .bind(1)
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await;

    assert!(dup_result.is_err());

    // Rollback due to error
    tx.rollback().await.unwrap();

    // Only the original workflow should exist
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count, 1,
        "Transaction should have rolled back both inserts in the tx"
    );
}

#[tokio::test]
async fn test_transaction_multi_table_rollback() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "Pre-existing WF").await;

    {
        let mut tx = pool.begin().await.unwrap();
        let now = Utc::now().to_rfc3339();

        // Insert execution in transaction
        let exec_id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO executions (id, workflow_id, status, trigger_type, started_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&exec_id)
        .bind(&wf_id)
        .bind("RUNNING")
        .bind("manual")
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();

        // Insert log in transaction
        sqlx::query(
            "INSERT INTO execution_logs (execution_id, level, message, timestamp) VALUES (?, ?, ?, ?)",
        )
        .bind(&exec_id)
        .bind("INFO")
        .bind("Started")
        .bind(&now)
        .execute(&mut *tx)
        .await
        .unwrap();

        // Drop without commit -> rollback
    }

    let exec_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM executions")
        .fetch_one(&pool)
        .await
        .unwrap();
    let log_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM execution_logs")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(exec_count, 0, "Executions should be rolled back");
    assert_eq!(log_count, 0, "Execution logs should be rolled back");
}

// ---------------------------------------------------------------------------
// 7. Additional coverage: config table, backlog unique constraint
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_config_crud() {
    let pool = setup_test_db().await;
    let now = Utc::now().to_rfc3339();

    // Create
    sqlx::query("INSERT INTO config (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)")
        .bind("github_token")
        .bind("ghp_test123")
        .bind(true)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

    // Read
    let row = sqlx::query("SELECT value, encrypted FROM config WHERE key = ?")
        .bind("github_token")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("value"), "ghp_test123");
    assert!(row.get::<bool, _>("encrypted"));

    // Update
    sqlx::query("UPDATE config SET value = ?, updated_at = ? WHERE key = ?")
        .bind("ghp_updated456")
        .bind(&now)
        .bind("github_token")
        .execute(&pool)
        .await
        .unwrap();

    let row = sqlx::query("SELECT value FROM config WHERE key = ?")
        .bind("github_token")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row.get::<String, _>("value"), "ghp_updated456");

    // Delete
    sqlx::query("DELETE FROM config WHERE key = ?")
        .bind("github_token")
        .execute(&pool)
        .await
        .unwrap();

    let row = sqlx::query("SELECT value FROM config WHERE key = ?")
        .bind("github_token")
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert!(row.is_none());
}

#[tokio::test]
async fn test_backlog_unique_constraint() {
    let pool = setup_test_db().await;
    let now = Utc::now().to_rfc3339();

    // Insert first item
    sqlx::query(
        "INSERT INTO backlog_items (id, owner, repo, issue_number, title, state, labels, assignees, html_url, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("owner/repo/1")
    .bind("owner")
    .bind("repo")
    .bind(1)
    .bind("First Issue")
    .bind("open")
    .bind("[]")
    .bind("[]")
    .bind("https://github.com/owner/repo/issues/1")
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Attempt duplicate (same owner/repo/issue_number)
    let result = sqlx::query(
        "INSERT INTO backlog_items (id, owner, repo, issue_number, title, state, labels, assignees, html_url, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind("owner/repo/1-dup")
    .bind("owner")
    .bind("repo")
    .bind(1)  // same issue_number
    .bind("Duplicate Issue")
    .bind("open")
    .bind("[]")
    .bind("[]")
    .bind("https://github.com/owner/repo/issues/1")
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await;

    assert!(
        result.is_err(),
        "UNIQUE(owner, repo, issue_number) should prevent duplicates"
    );
}

#[tokio::test]
async fn test_backlog_upsert() {
    let pool = setup_test_db().await;
    let now = Utc::now().to_rfc3339();

    // Insert
    sqlx::query(
        r#"INSERT INTO backlog_items (id, owner, repo, issue_number, title, state, labels, assignees, html_url, synced_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner, repo, issue_number) DO UPDATE SET
            title = excluded.title,
            state = excluded.state,
            synced_at = excluded.synced_at,
            updated_at = excluded.updated_at"#,
    )
    .bind("owner/repo/1")
    .bind("owner")
    .bind("repo")
    .bind(1)
    .bind("Original Title")
    .bind("open")
    .bind("[]")
    .bind("[]")
    .bind("https://github.com/owner/repo/issues/1")
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    // Upsert with updated title
    sqlx::query(
        r#"INSERT INTO backlog_items (id, owner, repo, issue_number, title, state, labels, assignees, html_url, synced_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner, repo, issue_number) DO UPDATE SET
            title = excluded.title,
            state = excluded.state,
            synced_at = excluded.synced_at,
            updated_at = excluded.updated_at"#,
    )
    .bind("owner/repo/1")
    .bind("owner")
    .bind("repo")
    .bind(1)
    .bind("Updated Title")
    .bind("closed")
    .bind("[]")
    .bind("[]")
    .bind("https://github.com/owner/repo/issues/1")
    .bind(&now)
    .bind(&now)
    .bind(&now)
    .execute(&pool)
    .await
    .unwrap();

    let row = sqlx::query(
        "SELECT title, state FROM backlog_items WHERE owner = ? AND repo = ? AND issue_number = ?",
    )
    .bind("owner")
    .bind("repo")
    .bind(1)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.get::<String, _>("title"), "Updated Title");
    assert_eq!(row.get::<String, _>("state"), "closed");

    // Should still be only 1 row
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM backlog_items")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

// ---------------------------------------------------------------------------
// 8. Execution lifecycle
// ---------------------------------------------------------------------------

#[tokio::test]
async fn test_execution_lifecycle() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "Lifecycle WF").await;

    let exec_id = Uuid::new_v4().to_string();
    let started = Utc::now().to_rfc3339();

    // Start execution
    sqlx::query(
        "INSERT INTO executions (id, workflow_id, status, trigger_type, started_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&exec_id)
    .bind(&wf_id)
    .bind("RUNNING")
    .bind("manual")
    .bind(&started)
    .execute(&pool)
    .await
    .unwrap();

    // Complete execution
    let completed = Utc::now().to_rfc3339();
    let context = json!({"trigger-1": {"status": "ok"}});
    let context_str = serde_json::to_string(&context).unwrap();

    sqlx::query("UPDATE executions SET status = ?, completed_at = ?, context = ? WHERE id = ?")
        .bind("COMPLETED")
        .bind(&completed)
        .bind(&context_str)
        .bind(&exec_id)
        .execute(&pool)
        .await
        .unwrap();

    let row = sqlx::query("SELECT status, completed_at, context FROM executions WHERE id = ?")
        .bind(&exec_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.get::<String, _>("status"), "COMPLETED");
    assert!(row.get::<Option<String>, _>("completed_at").is_some());

    let stored_context: Value =
        serde_json::from_str(&row.get::<Option<String>, _>("context").unwrap()).unwrap();
    assert_eq!(stored_context["trigger-1"]["status"], "ok");
}

#[tokio::test]
async fn test_execution_with_node_executions_and_logs() {
    let pool = setup_test_db().await;
    let wf_id = Uuid::new_v4().to_string();
    insert_workflow(&pool, &wf_id, "Full Lifecycle WF").await;

    let exec_id = Uuid::new_v4().to_string();
    insert_execution(&pool, &exec_id, &wf_id).await;

    let now = Utc::now().to_rfc3339();

    // Add node executions
    for node_id in &["trigger-1", "sync-1"] {
        sqlx::query(
            "INSERT INTO node_executions (id, execution_id, node_id, status, started_at, completed_at, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&exec_id)
        .bind(*node_id)
        .bind("COMPLETED")
        .bind(&now)
        .bind(&now)
        .bind(0)
        .execute(&pool)
        .await
        .unwrap();
    }

    // Add execution logs
    for (level, msg) in &[
        ("INFO", "Starting"),
        ("INFO", "Completed"),
        ("DEBUG", "Details"),
    ] {
        sqlx::query(
            "INSERT INTO execution_logs (execution_id, level, message, timestamp) VALUES (?, ?, ?, ?)",
        )
        .bind(&exec_id)
        .bind(*level)
        .bind(*msg)
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();
    }

    let node_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM node_executions WHERE execution_id = ?")
            .bind(&exec_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(node_count, 2);

    let log_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM execution_logs WHERE execution_id = ?")
            .bind(&exec_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(log_count, 3);
}
