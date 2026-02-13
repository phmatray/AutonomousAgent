# `claude.apply` Node

## Summary

Runs a Claude prompt to apply planned implementation changes.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `prompt` | string | Yes | - | Execution prompt/instructions. Supports templates. |
| `working_dir` | string | No | execution working directory | Working directory for Claude CLI. |
| `timeout_secs` | integer | No | `600` (provider default) | Command timeout in seconds. |

## Output

```json
{
  "output": "...",
  "success": true
}
```

## Behavior

- Resolves templates before execution.
- Executes `claude --print <prompt>`.
- Returns CLI output and a `success` flag when execution succeeds.

## Example

```json
{
  "prompt": "Implement the plan:\n{{claude.plan.plan}}",
  "working_dir": "{{git.worktree.worktree_path}}",
  "timeout_secs": 1200
}
```
