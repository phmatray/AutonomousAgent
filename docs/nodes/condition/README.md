# `condition` Node

## Summary

Evaluates a condition and returns branching output for `true` and `false` paths.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `condition` | any | Yes | - | Value to evaluate. Supports templates like `{{node_id.field}}`. |
| `operator` | string | No | `not_empty` | Comparison operator. |
| `value` | any | No | `null` | Comparison value for binary operators. |

Supported `operator` values:
- `exists`
- `not_empty`
- `eq`
- `neq`
- `gt`
- `lt`
- `gte`
- `lte`

## Output

```json
{
  "result": true,
  "branch": "true"
}
```

## Behavior

- Resolves templates before evaluation.
- Numeric comparisons (`gt`, `lt`, `gte`, `lte`) coerce missing/non-numeric values to `0.0`.
- Returns `branch: "true"` when condition is met, otherwise `branch: "false"`.

## Example

```json
{
  "condition": "{{readIssues.count}}",
  "operator": "gt",
  "value": 0
}
```
