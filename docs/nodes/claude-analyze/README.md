# `claude.analyze` Node

## Summary

Runs a Claude prompt for analysis and returns analysis text.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `prompt` | string | Yes | - | Analysis prompt/instructions. Supports templates. |
| `working_dir` | string | No | execution working directory | Working directory for Claude CLI. |
| `timeout_secs` | integer | No | `600` (provider default) | Command timeout in seconds. |

## Output

```json
{
  "analysis": "..."
}
```

## Behavior

- Resolves templates before execution.
- Executes `claude --print <prompt>`.
- Uses node-level `working_dir` override when provided.

## Example

```json
{
  "prompt": "Analyze issue {{loop.current_item.number}} and summarize risks.",
  "working_dir": "{{github.sync.repo_path}}",
  "timeout_secs": 300
}
```
