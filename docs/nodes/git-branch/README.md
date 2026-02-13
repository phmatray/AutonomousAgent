# `git.branch` Node

## Summary

Builds a gitflow-style branch name and creates the branch in a repository.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `repo_path` | string | No | execution working directory | Repository path. Supports templates. |
| `branch_type` | string | No | `feature` | Gitflow branch prefix (`feature`, `hotfix`, `release`). |
| `name` | string | Yes | - | Branch name suffix used to build final branch name. |

## Output

```json
{
  "branch_name": "feature/my-change"
}
```

## Behavior

- Resolves templates before execution.
- Branch name is generated via gitflow naming helper.
- Requires either `repo_path` or a previously set execution working directory.

## Example

```json
{
  "repo_path": "{{git.worktree.worktree_path}}",
  "branch_type": "feature",
  "name": "standardized-node-docs"
}
```
