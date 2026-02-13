pub const CREATE_WORKFLOWS_TABLE: &str = r#"
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

pub const CREATE_EXECUTIONS_TABLE: &str = r#"
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
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
)
"#;

pub const CREATE_EXECUTION_LOGS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS execution_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    execution_id TEXT NOT NULL,
    node_id TEXT,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
)
"#;

pub const CREATE_NODE_EXECUTIONS_TABLE: &str = r#"
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
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
)
"#;

pub const CREATE_CONFIG_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    encrypted BOOLEAN DEFAULT FALSE,
    updated_at TEXT NOT NULL
)
"#;

pub const CREATE_BACKLOG_ITEMS_TABLE: &str = r#"
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
    resolution_guidelines_md TEXT,
    synced_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner, repo, issue_number),
    FOREIGN KEY (linked_workflow_id) REFERENCES workflows(id) ON DELETE SET NULL
)
"#;

pub const CREATE_WORKFLOW_SCHEDULES_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS workflow_schedules (
    workflow_id TEXT PRIMARY KEY,
    trigger_type TEXT NOT NULL,
    cron_expression TEXT,
    timezone TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
)
"#;

pub const CREATE_SCHEMA_VERSION_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)
"#;

pub const CREATE_INDEXES: &str = r#"
-- Indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at);
CREATE INDEX IF NOT EXISTS idx_node_executions_execution_id ON node_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_node_executions_node_id ON node_executions(node_id);
CREATE INDEX IF NOT EXISTS idx_node_executions_status ON node_executions(status);
CREATE INDEX IF NOT EXISTS idx_execution_logs_execution_id ON execution_logs(execution_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_node_id ON execution_logs(node_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_timestamp ON execution_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_backlog_items_owner_repo ON backlog_items(owner, repo);
CREATE INDEX IF NOT EXISTS idx_backlog_items_state ON backlog_items(state);
CREATE INDEX IF NOT EXISTS idx_backlog_items_linked_workflow_id ON backlog_items(linked_workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_trigger_enabled_next
ON workflow_schedules(trigger_type, enabled, next_run_at);
"#;
