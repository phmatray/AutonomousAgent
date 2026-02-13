# Architecture

This document describes the architecture of the Autonomous Agent application.

## High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │Dashboard │ │ Editor   │ │Monitoring│ │ Settings │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │
│       │             │             │             │        │
│  ┌────┴─────────────┴─────────────┴─────────────┴────┐  │
│  │              Tauri IPC (invoke / events)           │  │
│  └───────────────────────┬───────────────────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────┐
│                    Rust Backend                          │
│  ┌───────────────────────┴───────────────────────────┐  │
│  │              Command Handlers (23 commands)        │  │
│  └──┬──────────┬──────────┬──────────┬───────────────┘  │
│     │          │          │          │                   │
│  ┌──┴───┐  ┌──┴───┐  ┌──┴───┐  ┌──┴──────────────┐   │
│  │GitHub│  │Claude│  │ Git  │  │Workflow Engine  │   │
│  │Client│  │Exec. │  │Serv. │  │  ┌────────────┐ │   │
│  └──┬───┘  └──┬───┘  └──┬───┘  │  │DAG Executor│ │   │
│     │         │         │       │  ├────────────┤ │   │
│     │         │         │       │  │Node Registry│ │  │
│     │         │         │       │  ├────────────┤ │   │
│     │         │         │       │  │State Machine│ │  │
│     │         │         │       │  └────────────┘ │   │
│     │         │         │       └─────────────────┘   │
│  ┌──┴───┐  ┌──┴───┐  ┌──┴───┐  ┌──────────────────┐  │
│  │Octo- │  │claude│  │git2  │  │     SQLite       │  │
│  │crab  │  │ CLI  │  │+ CLI │  │   (SQLx 0.8)     │  │
│  └──────┘  └──────┘  └──────┘  └──────────────────┘  │
│  ┌────────────────────────────────────────────────┐    │
│  │           OS Keyring (keyring 3.6)             │    │
│  └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Backend Services

### AppState

All services are bundled into `AppState` which is registered as Tauri managed state. Every command handler receives it via `State<'_, AppState>`.

```rust
pub struct AppState {
    pub storage: StorageService,      // Token management
    pub github: GitHubClient,         // GitHub API
    pub claude: ClaudeExecutor,       // Claude CLI
    pub git: GitService,              // Git operations
    pub engine: WorkflowEngine,       // Workflow CRUD + execution
}
```

### StorageService (`services/storage.rs`)

Manages GitHub Personal Access Tokens using the OS keyring.

- **keyring 3.6**: Uses `keyring::Entry` with service name `autonomous-agent` and username `github-token`
- **Operations**: `set_github_token`, `get_github_token`, `delete_github_token`, `has_github_token`
- **Platforms**: macOS Keychain, Windows Credential Manager, Linux Secret Service (via D-Bus)

### GitHubClient (`services/github_client.rs`)

Wraps the Octocrab GitHub API client with shared mutable state.

- **Thread safety**: `Arc<RwLock<Option<Octocrab>>>` allows concurrent read access and exclusive write for authentication
- **Session restore**: `clone_for_restore()` creates a reference for async session restoration during app setup
- **Operations**: authenticate, list repos, list issues, create PR, create branch, get user info

### ClaudeExecutor (`services/claude_executor.rs`)

Manages Claude Code CLI processes as streaming executions.

- **Process management**: Spawns `claude --print <prompt>` via `tokio::process::Command`
- **Streaming**: Reads stdout/stderr line-by-line via `BufReader` and emits Tauri events
- **Events**:
  - `claude:output:stdout` - Each line of stdout
  - `claude:output:stderr` - Each line of stderr
  - `claude:execution:complete` - Final result with success/failure status
- **Timeout**: Configurable timeout (default 600s) via `tokio::time::timeout`
- **Cancellation**: Running processes tracked in `HashMap<String, RunningExecution>`, abortable via `JoinHandle::abort()`

### GitService (`services/git_service.rs`)

Combines git2-rs for fast local operations with Git CLI for complex operations.

**git2-rs (fast, no subprocess)**:
- `status` - Working tree status (modified, staged, untracked files)
- `log` - Commit history via revwalk
- `diff_summary` - Stats for uncommitted changes
- `get_head_sha` - Current HEAD commit SHA

**Git CLI (for operations git2 doesn't support well)**:
- Worktree management: create, list, remove
- Branch operations: create, checkout
- Remote operations: push, pull, clone
- Staging and committing: add all, commit

**Static helpers**:
- `gitflow_branch_name(type, name)` - Generates gitflow-compliant branch names
- `conventional_commit(type, scope, description, gitmoji)` - Formats conventional commit messages with gitmoji

## Workflow Engine

### WorkflowEngine (`services/workflow_engine/mod.rs`)

Central orchestrator for workflow lifecycle management.

- **CRUD**: Create, read, update, delete workflows via SQLx queries
- **Execution**: `execute_workflow` creates an execution record, resolves the DAG, and runs nodes level-by-level
- **Logging**: `get_execution_logs` retrieves timestamped logs for monitoring
- **Async initialization**: DB pool and services are injected after app setup via `RwLock` handles

### DAG Executor (`services/workflow_engine/executor.rs`)

Converts workflow edges into an execution plan.

1. **Build DAG**: Constructs adjacency list and in-degree map from edges
2. **Topological sort**: Kahn's algorithm to detect cycles and establish execution order
3. **Level grouping**: Nodes with the same topological depth form a level; all nodes in a level execute in parallel
4. **Condition branching**: `condition` nodes output `true`/`false` on different handles; only the matching branch proceeds

### Node Registry (`services/workflow_engine/node_registry.rs`)

Maps node type strings to executor implementations.

**NodeExecutor trait**:
```rust
#[async_trait]
pub trait NodeExecutor: Send + Sync {
    async fn execute(&self, node_id: &str, config: &Value,
                     context: &mut ExecutionContext, services: &ServiceProvider) -> Result<Value>;
    fn validate(&self, config: &Value) -> Result<()>;
    fn node_type(&self) -> &'static str;
}
```

**ExecutionContext**:
- Holds global workflow config and per-node outputs
- `resolve_reference("{{node.field}}")` - Navigates JSON paths in node outputs
- `resolve_value(value)` - Recursively resolves `{{ref}}` patterns in any JSON value

**ServiceProvider**: Wraps `Arc<GitHubClient>`, `Arc<ClaudeProvider>`, `Arc<GitService>` so node executors don't depend on Tauri state.

### State Machine (`services/workflow_engine/state_machine.rs`)

Enforces valid state transitions for workflows and nodes.

```
WorkflowState:
  IDLE -> SCHEDULED -> RUNNING -> COMPLETED
                               -> FAILED
                               -> CANCELLED
  RUNNING -> PAUSED -> RUNNING (resume)

NodeState:
  PENDING -> RUNNING -> COMPLETED
                     -> FAILED
                     -> SKIPPED
  FAILED -> RUNNING (retry)
```

### Node Implementations (`services/workflow_engine/nodes/`)

Each node type implements `NodeExecutor`:

| File | Nodes | Description |
|------|-------|-------------|
| `github.rs` | `GithubSyncNode`, `GithubReadIssuesNode`, `GithubCreatePrNode` | Clone/pull repos, fetch issues, create PRs via octocrab |
| `git.rs` | `GitWorktreeNode`, `GitBranchNode`, `GitCommitNode` | Worktree management, branching, conventional commits |
| `claude.rs` | `ClaudePlanNode`, `ClaudeApplyNode`, `ClaudeAnalyzeNode` | Run Claude CLI with different prompt strategies |
| `control.rs` | `TriggerNode`, `ConditionNode`, `LoopNode`, `DelayNode` | Workflow control flow |

## Frontend Architecture

### Pages

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `DashboardPage` | Overview of workflows and recent executions |
| `/editor` | `EditorPage` | Visual workflow editor using @xyflow/react |
| `/monitoring` | `MonitoringPage` | Real-time execution monitoring with log streaming |
| `/settings` | `SettingsPage` | GitHub token configuration and auth status |

### API Layer (`lib/api/`)

Thin wrappers around `@tauri-apps/api/core` invoke calls. Each file maps 1:1 to a backend command category:

- `github.ts` - GitHub auth, repos, issues, PRs
- `workflow.ts` - Workflow CRUD, execution, logs
- `claude.ts` - Claude execution management + Tauri event listeners

### State Management

- **Zustand** (`features/workflow-editor/stores/editor-store.ts`): Manages the workflow editor state (nodes, edges, selection, drag state)
- **TanStack Query**: Manages all server state (workflows, executions, auth status) with automatic refetching and caching

### Streaming Events

The monitoring page uses Tauri's event system for real-time updates:

1. Frontend subscribes to `execution-log-{executionId}` events
2. Backend emits log events as nodes execute
3. `LogViewer` component auto-scrolls to show latest entries
4. Live indicator pulses while execution status is `RUNNING`

## Pre-built Workflow Template

The "Autonomous Developer" template (`lib/templates/autonomous-developer.ts`) implements the full autonomous issue resolution pipeline:

```
trigger -> github.sync -> github.readIssues -> condition(hasIssues)
                                                    |
                                               [true branch]
                                                    |
                                              claude.plan -> git.worktree -> claude.apply -> git.commit -> github.createPR
```

Template references use `{{nodeId.field}}` syntax for data flow between nodes (e.g., `{{sync.owner}}`, `{{readIssues.issues.0.title}}`).

## Error Handling

### Backend

All errors funnel through `AppError` (`errors/types.rs`):

```rust
pub enum AppError {
    NotFound(String),
    Validation(String),
    GitHub(String),
    Git(git2::Error),
    Db(sqlx::Error),
    Io(std::io::Error),
    Keyring(String),
    Timeout,
    Tauri(tauri::Error),
    Unknown(String),
}
```

`AppError` implements `Serialize`, which Tauri 2 uses to automatically convert errors into IPC error responses.

### Frontend

- TanStack Query handles retry logic and error states for queries
- Mutations surface errors via `isError` / `error` fields in UI components
- Claude execution errors are streamed back via the `claude:execution:complete` event

## Testing

20 unit tests covering:

- **GitService** (8 tests): Branch name generation, conventional commit formatting
- **NodeRegistry** (8 tests): Execution context, reference resolution, registry completeness
- **DAG Executor** (2 tests): DAG building, cycle detection
- **State Machine** (2 tests): Valid and invalid state transitions
