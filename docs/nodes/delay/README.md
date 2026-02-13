# `delay` Node

## Summary

Pauses workflow execution for a configured number of seconds.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `seconds` | integer | Yes | `1` | Wait duration in seconds. |

## Output

```json
{
  "waited_seconds": 5
}
```

## Behavior

- Validates `seconds` is present and an unsigned integer.
- Uses asynchronous sleep (`tokio::time::sleep`).
- Does not resolve templates in config.

## Example

```json
{
  "seconds": 30
}
```
