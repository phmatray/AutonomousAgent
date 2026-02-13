# `trigger.cron` Node

## Summary

Entry point node for cron-scheduled workflows.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `schedule` | string | Yes | `0 * * * *` | Cron expression used by external schedulers. |
| `timezone` | string | No | `UTC` | IANA timezone identifier (informational). |

## Output

```json
{
  "triggered_at": "2026-02-13T16:00:00Z",
  "trigger_type": "cron",
  "schedule": "0 * * * *",
  "timezone": "UTC"
}
```

## Behavior

- Emits current UTC timestamp in RFC3339 format.
- Returns `trigger_type = "cron"` and echoes schedule metadata.
- Does not schedule itself; scheduler integration controls run timing.

## Example

```json
{
  "schedule": "0 */6 * * *",
  "timezone": "Europe/Paris"
}
```
