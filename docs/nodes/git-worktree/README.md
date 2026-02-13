# `git.worktree` Node

## Summary

Creates a new git worktree and branch for isolated implementation work.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `repo_path` | string | No | execution working directory | Source repository path. Supports templates. |
| `worktree_path` | string | Yes | - | Target filesystem path for new worktree. Supports templates. |
| `branch_name` | string | Yes | - | Branch created in the new worktree. Supports templates. |

## Output

```json
{
  "worktree_path": "/tmp/worktrees/feature-123",
  "branch_name": "feature/issue-123"
}
```

## Behavior

- Resolves templates before execution.
- Requires either `repo_path` or a previously set execution working directory.
- Updates execution working directory to the created worktree path.

## Example

```json
{
  "repo_path": "{{github.sync.repo_path}}",
  "worktree_path": "/tmp/worktrees/issue-123",
  "branch_name": "feature/issue-123"
}
```
