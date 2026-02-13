# `backlog.syncIssues` Node

## Summary

Fetches open issues from a GitHub repository and upserts them into backlog storage.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `owner` | string | Yes | - | GitHub repository owner. Supports templates. |
| `repo` | string | Yes | - | GitHub repository name. Supports templates. |
| `credential_id` | string | No | default credential/session | Credential selector used for auth. |

`credential_id` behavior:
- `__active_session__`: use current in-memory authenticated session.
- Omitted: uses stored default token or active session.

## Output

```json
{
  "owner": "acme",
  "repo": "my-repo",
  "count": 12,
  "items": []
}
```

## Behavior

- Resolves templates before execution.
- Requires authentication (token or active session).
- Fetches open issues from GitHub, then inserts or updates `backlog_items`.
- Returns synced backlog items for the selected repository.

## Example

```json
{
  "owner": "{{github.sync.owner}}",
  "repo": "{{github.sync.repo}}"
}
```
