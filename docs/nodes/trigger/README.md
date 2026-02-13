# `trigger` Node

## Summary

Entry point node that starts workflow execution and emits trigger metadata.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `trigger_type` | string | No | `manual` | Informational trigger type (for example: `manual`, `webhook`, `state`). |

## Output

```json
{
  "triggered_at": "2026-02-13T16:00:00Z",
  "trigger_type": "manual"
}
```

## Behavior

- Emits current UTC timestamp in RFC3339 format.
- Does not validate `trigger_type` against an allowed list.
- Does not perform template resolution on config.
- This node is an entry point and does not accept inbound connections.

## Example

```json
{
  "trigger_type": "manual"
}
```
