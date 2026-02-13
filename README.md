# Autonomous Agent

An autonomous AI developer system that can automatically resolve GitHub issues by orchestrating Claude Code CLI and GitHub API through a visual workflow interface.

## Overview

This project provides a desktop application (built with Tauri + React) similar to n8n that enables workflow automation for AI-powered development tasks. The system can autonomously:

1. Sync a configurable GitHub repository
2. Read issues from the repository
3. Plan solutions using Claude Code
4. Create git worktrees and branches
5. Apply solutions via Claude Code
6. Commit changes with conventional commits + gitmoji
7. Create pull requests

## Technology Stack

### Frontend
- **React 19** + TypeScript (type-safe UI development)
- **Vite** (fast development server and builds)
- **React Flow** (node-based workflow editor)
- **Tailwind CSS** (utility-first styling)
- **Zustand** (lightweight state management)
- **TanStack Query v5** (server state caching)

### Backend (Tauri/Rust)
- **Tauri v2** (secure native desktop app framework)
- **SQLite** (workflow and execution persistence)
- **Octocrab** (GitHub API client)
- **tokio** (async runtime)
- **git2-rs** (git operations)

## Project Structure

```
autonomous-agent/
├── src/                     # React Frontend
│   ├── app/                 # Application shell
│   ├── features/            # Feature modules
│   ├── components/          # Shared UI components
│   ├── lib/                 # Utilities and API clients
│   └── types/               # TypeScript type definitions
│
├── src-tauri/              # Rust Backend
│   ├── src/
│   │   ├── commands/       # Tauri commands (frontend API)
│   │   ├── services/       # Business logic
│   │   ├── models/         # Data models
│   │   ├── db/             # Database layer
│   │   └── errors/         # Error types
│   │
│   └── Cargo.toml
│
└── package.json
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Rust 1.70+
- Git

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd autonomous-agent
   ```

2. Install frontend dependencies:
   ```bash
   npm install
   ```

3. Install Rust dependencies (happens automatically on first build)

### Development

Run the development server:

```bash
npm run tauri:dev
```

This will start both the Vite dev server and the Tauri application.

### Building

Build the production application:

```bash
npm run tauri:build
```

The built application will be available in `src-tauri/target/release`.

## Configuration

Copy `.env.example` to `.env` and configure:

```env
GITHUB_TOKEN=your_github_token_here
```

## Git Workflow

This project follows the **Gitflow** branching model:

- `main` - Production-ready code
- `develop` - Integration branch for features
- `feature/*` - Feature branches
- `hotfix/*` - Hotfix branches
- `release/*` - Release branches

### Commit Convention

We use **Conventional Commits** with **Gitmoji**:

```
{gitmoji} {type}({scope}): {description}

Example: ✨ feat(auth): add OAuth integration
```

## Architecture

### Database Schema

The application uses SQLite with the following tables:

- `workflows` - Workflow definitions
- `executions` - Workflow execution history
- `execution_logs` - Detailed execution logs
- `node_executions` - Individual node execution state
- `config` - Application configuration

### Workflow Nodes

**GitHub Nodes:**
- `github.sync` - Clone/pull repository
- `github.readIssues` - Fetch issues
- `github.createPR` - Create pull request

**Git Nodes:**
- `git.worktree` - Create git worktree
- `git.branch` - Create feature branch
- `git.commit` - Commit changes

**Claude Nodes:**
- `claude.analyze` - Analyze issue context
- `claude.plan` - Generate implementation plan
- `claude.apply` - Execute plan via CLI

**Control Flow:**
- `trigger` - Start workflow
- `condition` - Branch based on condition
- `loop` - Iterate over array
- `delay` - Wait for duration

## Security

- GitHub tokens stored securely in OS keyring (macOS Keychain, Windows Credential Manager)
- Encrypted fallback storage via Tauri Store
- No token exposure to frontend
- Input validation on all user inputs

## Development Roadmap

- [x] Phase 1: Project Scaffold
- [ ] Phase 2: Backend Services
- [ ] Phase 3: Workflow Engine
- [ ] Phase 4: React UI
- [ ] Phase 5: Integration & Testing

## License

MIT

## Contributing

Contributions are welcome! Please follow the git workflow and commit conventions outlined above.
