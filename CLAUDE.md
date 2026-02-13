# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Autonomous Agent is a Tauri v2 + React 19 desktop application that provides a visual workflow automation system for autonomous AI development. Think of it as "n8n for AI development" - users can create workflows with drag-and-drop nodes that orchestrate GitHub API, Claude Code CLI, and git operations to autonomously resolve issues.

**Required External Tool**: The Claude Code CLI (`claude`) must be installed and available on PATH for Claude node execution.

## Development Commands

### Frontend Development
```bash
npm run tauri:dev          # Start Vite dev server + Tauri app with hot reload
npm run dev                # Start Vite dev server only (for frontend-only work)
npm run build              # Build frontend with TypeScript compilation
npx tsc --noEmit           # Type-check without emitting files
```

### Backend Development
```bash
cd src-tauri && cargo test                    # Run full Rust test suite
cd src-tauri && cargo test node_registry     # Run specific test module
cd src-tauri && cargo build                   # Build Rust backend
cd src-tauri && cargo clippy                  # Lint Rust code
```

### Production Build
```bash
npm run tauri:build        # Build production app (output: src-tauri/target/release)
```

## Architecture

### High-Level Structure

**Frontend (React 19 + TypeScript)**
- **React Router** with 4 main routes: `/dashboard`, `/editor/:id?`, `/monitoring`, `/settings`
- **TanStack Query v5** for server state management (queries/mutations for all Tauri commands)
- **Zustand** for workflow editor local state (nodes, edges, canvas interactions)
- **@xyflow/react** powers the visual workflow editor
- **Tailwind CSS** for styling
- **TypeScript path alias**: `@/*` maps to `./src/*`

**Backend (Rust + Tauri v2)**
- **Tauri IPC**: 23 registered commands handle frontend requests via `invoke()`
- **AppState**: Managed by Tauri, contains `Arc<>`-wrapped services (storage, github, claude, git, workflow engine)
- **SQLite database** (SQLx with async migrations): 5 tables for workflow/execution persistence
- **OS Keyring**: GitHub tokens stored securely (macOS Keychain / Windows Credential Manager / Linux Secret Service)
- **Async runtime**: Tokio with `#[tokio::main]`

### Workflow Engine Architecture

The workflow engine executes user-defined workflows as **Directed Acyclic Graphs (DAGs)**:

1. **Node Registry Pattern**
   - Every node type implements the `NodeExecutor` async trait
   - Registry maps node type strings (e.g., `"github.sync"`) to executor instances
   - 13 built-in node types across 4 categories: GitHub, Git, Claude, Control Flow

2. **DAG Execution**
   - Topological sort (Kahn's algorithm) groups nodes into execution levels
   - Nodes in the same level execute in parallel (no dependencies between them)
   - Levels execute sequentially (level N+1 waits for level N to complete)
   - Cycle detection prevents infinite loops

3. **Template Resolution System**
   - Node configs use `{{nodeId.field}}` syntax to reference previous outputs
   - `ExecutionContext` maintains a `HashMap<String, Value>` of node outputs
   - Resolution happens at runtime before node execution
   - Example: `{"repo": "{{sync.repo}"}` resolves to `{"repo": "my-repo"}`

4. **State Machine**
   - Workflow states: `IDLE -> SCHEDULED -> RUNNING -> COMPLETED/FAILED/CANCELLED`
   - Node states: Same lifecycle tracked per-node in `node_executions` table
   - Retry policy supports linear/exponential backoff

5. **Service Provider Pattern**
   - `ServiceProvider` struct passed to every node executor
   - Provides `Arc<GitHubClient>`, `Arc<ClaudeProvider>`, `Arc<GitService>`
   - Decouples node implementations from Tauri state management

### Data Flow: Frontend → Backend → Workflow Engine

1. **User Action**: User clicks "Execute" in UI
2. **Frontend**: Calls `executeWorkflow(workflowId)` → `invoke('execute_workflow', {workflowId})`
3. **Tauri Command**: `commands::workflow::execute_workflow()` handler receives request
4. **Workflow Engine**:
   - Fetches workflow from SQLite (`workflows` table)
   - Creates `ExecutionContext` with workflow config
   - Builds DAG from workflow edges
   - Executes nodes level-by-level
   - Records results to `executions` and `node_executions` tables
5. **Response**: Returns `WorkflowExecutionResult` with status + node outputs
6. **Frontend**: TanStack Query updates cache, UI re-renders with execution history

### Database Schema

**SQLite** with SQLx migrations. Key tables:

- `workflows`: Workflow definitions (JSON columns for nodes/edges/config)
- `executions`: Workflow execution history (status, timestamps, error)
- `node_executions`: Per-node execution details (input/output, retry count)
- `execution_logs`: Timestamped log entries (level, message, metadata)
- `config`: Key-value app configuration

**Important**: Database pool initialization is async on app startup. Workflow engine methods await `get_pool()` which will error if DB not initialized.

### Node Types Reference

All nodes implement `async fn execute(&self, node_id, config, context, services) -> Result<Value>`:

**GitHub Nodes** (`src-tauri/src/services/workflow_engine/nodes/github.rs`)
- `github.sync`: Clone or pull repository
- `github.readIssues`: Fetch open issues
- `github.createPR`: Create pull request

**Git Nodes** (`src-tauri/src/services/workflow_engine/nodes/git.rs`)
- `git.worktree`: Create git worktree + branch
- `git.branch`: Create/checkout branch
- `git.commit`: Stage all + commit with conventional commit format

**Claude Nodes** (`src-tauri/src/services/workflow_engine/nodes/claude.rs`)
- `claude.analyze`: Run analysis prompt
- `claude.plan`: Generate implementation plan
- `claude.apply`: Execute solution (runs `claude` CLI subprocess)

**Control Flow** (`src-tauri/src/services/workflow_engine/nodes/control.rs`)
- `trigger`: Workflow entry point
- `condition`: Branch based on expression
- `loop`: Iterate over array
- `delay`: Sleep for duration

### Frontend-Backend Communication

All communication uses **Tauri's invoke system** with strongly-typed requests/responses:

```typescript
// Frontend (TypeScript)
import { invoke } from '@tauri-apps/api/core';
const workflows = await invoke<Workflow[]>('list_workflows');
```

```rust
// Backend (Rust)
#[tauri::command]
async fn list_workflows(state: State<'_, AppState>) -> Result<Vec<Workflow>, AppError> {
    state.engine.list_workflows().await
}
```

**Error Handling**: Rust `AppError` automatically serializes to frontend errors via `thiserror` + Tauri's error handling.

### Key Service Implementations

**GitHubClient** (`src-tauri/src/services/github_client.rs`)
- Uses `octocrab` crate for GitHub API v3
- Token stored via `Storage` service in OS keyring
- Session restoration on app startup if token exists

**ClaudeProvider** (`src-tauri/src/services/workflow_engine/node_registry.rs`)
- Spawns `claude` CLI subprocess via `tokio::process::Command`
- Collects stdout (with timeout)
- No Tauri event streaming in workflow context

**GitService** (`src-tauri/src/services/git_service.rs`)
- Combines `git2` crate (libgit2) for core operations
- Falls back to CLI `git` commands for worktrees (not in libgit2)
- Working directory tracked in `ExecutionContext`

**Storage** (`src-tauri/src/services/storage.rs`)
- Uses `keyring` crate for OS keychain integration
- Key format: `"autonomous-agent.github_token"`
- Supports macOS Keychain, Windows Credential Manager, Linux Secret Service

## Development Guidelines

### Adding a New Node Type

1. **Create executor struct** in `src-tauri/src/services/workflow_engine/nodes/[category].rs`
2. **Implement `NodeExecutor` trait**:
   ```rust
   #[async_trait]
   impl NodeExecutor for MyNewNode {
       fn node_type(&self) -> &'static str { "category.myNode" }

       async fn execute(&self, node_id: &str, config: &Value,
                       context: &mut ExecutionContext,
                       services: &ServiceProvider) -> Result<Value> {
           // Implementation
       }

       fn validate(&self, config: &Value) -> Result<()> {
           // Config validation
       }
   }
   ```
3. **Register in `build_default_registry()`** in `node_registry.rs`
4. **Add frontend types** to `src/types/workflow.ts`
5. **Create UI component** in `src/features/workflow-editor/components/nodes/`

### Adding a New Tauri Command

1. **Define handler** in `src-tauri/src/commands/[category].rs`:
   ```rust
   #[tauri::command]
   pub async fn my_command(
       param: String,
       state: State<'_, AppState>
   ) -> Result<ReturnType, AppError> {
       // Implementation
   }
   ```
2. **Register in `main.rs`** in `.invoke_handler(tauri::generate_handler![...])`
3. **Add TypeScript wrapper** in `src/lib/api/[category].ts`:
   ```typescript
   export async function myCommand(param: string): Promise<ReturnType> {
       return invoke('my_command', { param });
   }
   ```
4. **Create TanStack Query hook** if needed in `src/lib/hooks/`

### Testing Workflow Execution Locally

1. Start the app: `npm run tauri:dev`
2. Go to **Settings** → Enter GitHub PAT (scopes: `repo`, `workflow`)
3. Go to **Dashboard** → Create new workflow or use "Autonomous Developer" template
4. Open in **Editor** → Configure nodes (repo URL, issue number, etc.)
5. Click **Execute** → Monitor in **Monitoring** tab
6. Check SQLite database: `src-tauri/autonomous-agent.db` (use DB Browser for SQLite)

### Git Workflow

This project uses **Gitflow**:
- `main`: Production releases
- `develop`: Integration branch
- `feature/*`: New features (branch from `develop`)
- `hotfix/*`: Critical fixes (branch from `main`)
- `release/*`: Release preparation

**Commit Convention**: Conventional Commits + Gitmoji

Format: `{gitmoji} {type}({scope}): {description}`

Examples:
- `✨ feat(editor): add loop node support`
- `🐛 fix(workflow): resolve circular dependency detection`
- `♻️ refactor(services): extract GitHub client to separate module`

Common gitmojis:
- ✨ feat | 🐛 fix | 📝 docs | 💄 style | ♻️ refactor | ⚡ perf | ✅ test | 🔧 chore

## Common Pitfalls

1. **Database not initialized**: Workflow engine operations will fail if called before DB setup completes. Check `is_initialized()` or ensure proper async startup sequencing.

2. **Missing Claude CLI**: Claude nodes will fail if `claude` is not on PATH. Error message should indicate this clearly.

3. **Template resolution edge cases**: `{{ref}}` only resolves in string values, not mid-string (e.g., `"path/{{ref}}/file"` won't resolve). Nodes must handle this if needed.

4. **Async trait limitations**: `NodeExecutor` uses `async_trait` - don't manually implement, use the macro.

5. **SQLite JSON columns**: `nodes`, `edges`, `config` stored as TEXT. Must serialize/deserialize on every DB operation.

6. **Working directory state**: Git/Claude operations depend on `ExecutionContext.working_dir` being set by upstream nodes (e.g., `github.sync`).

7. **Circular dependencies**: DAG builder will error on cycles. UI should validate this before execution.

8. **GitHub token expiry**: No automatic token refresh. User must re-authenticate if token expires.
