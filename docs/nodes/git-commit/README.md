# `git.commit` Node

## Summary

Stages all changes and creates a conventional commit message (with optional gitmoji).

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `repo_path` | string | No | execution working directory | Repository path. Supports templates. |
| `commit_type` | string | Yes | `feat` | Conventional commit type (`feat`, `fix`, `docs`, etc.). |
| `scope` | string | No | none | Optional conventional scope. |
| `description` | string | Yes | - | Commit description text. |
| `gitmoji` | string | No | inferred/default | Optional explicit gitmoji. |

## Output

```json
{
  "sha": "abc123...",
  "message": "📝 docs(nodes): add standardized readmes"
}
```

## Behavior

- Resolves templates before execution.
- Requires either `repo_path` or a previously set execution working directory.
- Stages all tracked/untracked changes before committing.

## Example

```json
{
  "repo_path": "{{git.worktree.worktree_path}}",
  "commit_type": "docs",
  "scope": "nodes",
  "description": "add standardized workflow node README files"
}
```
