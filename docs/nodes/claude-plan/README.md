# `claude.plan` Node

## Summary

Runs a Claude prompt to generate an implementation plan.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `prompt` | string | Yes | - | Planning prompt/instructions. Supports templates. |
| `working_dir` | string | No | execution working directory | Working directory for Claude CLI. |
| `timeout_secs` | integer | No | `600` (provider default) | Command timeout in seconds. |

## Output

```json
{
  "plan": "..."
}
```

## Behavior

- Resolves templates before execution.
- Executes `claude --print <prompt>`.
- Intended for structured implementation planning output.

## Example

```json
{
  "prompt": "Create an implementation plan for issue {{loop.current_item.title}}.",
  "working_dir": "{{github.sync.repo_path}}"
}
```
