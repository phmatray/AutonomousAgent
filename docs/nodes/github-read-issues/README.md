# `github.readIssues` Node

## Summary

Fetches open issues from a GitHub repository.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `owner` | string | Yes | - | GitHub repository owner. Supports templates. |
| `repo` | string | Yes | - | GitHub repository name. Supports templates. |
| `credential_id` | string | No | default credential/session | Credential selector used for auth. |

## Output

```json
{
  "issues": [
    {
      "number": 123,
      "title": "Bug report",
      "body": "...",
      "state": "open",
      "labels": [],
      "assignees": []
    }
  ],
  "count": 1
}
```

## Behavior

- Resolves templates before execution.
- Requires authentication (token or active session).
- Returns a normalized issue list with selected fields.
- Automatically paginates through all open issues (not just the first page).

## Example

```json
{
  "owner": "{{github.sync.owner}}",
  "repo": "{{github.sync.repo}}"
}
```
