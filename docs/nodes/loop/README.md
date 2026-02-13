# `loop` Node

## Summary

Initializes loop execution over an array and emits the first item plus loop metadata.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `items` | array | Yes | - | Array to iterate. Supports templates like `{{node_id.field}}`. |
| `max_iterations` | integer | No | `items.length` | Optional cap on processed items. |

## Output

```json
{
  "current_item": {},
  "index": 0,
  "total": 10,
  "items": []
}
```

## Behavior

- Resolves templates before reading values.
- Validates `items` is an array and fails otherwise.
- Caps returned `items` based on `max_iterations`.
- Sets `current_item` to first capped item, or `null` if empty.

## Example

```json
{
  "items": "{{github.readIssues.issues}}",
  "max_iterations": 25
}
```
