# `github.sync` Node

## Summary

Ensures a repository is available locally by cloning or pulling, then updates workflow working directory.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `owner` | string | Yes | - | GitHub repository owner. |
| `repo` | string | Yes | - | GitHub repository name. |
| `path` | string | Yes | - | Parent directory where repo should exist locally. |
| `credential_id` | string | No | default credential/session | Credential selector used for auth. |

`credential_id` behavior:
- `__active_session__`: use current in-memory authenticated session.
- Omitted: tries stored default token, falls back to unauthenticated access if available.

## Output

```json
{
  "repo_path": "/tmp/repos/my-repo",
  "owner": "acme",
  "repo": "my-repo"
}
```

## Behavior

- If `<path>/<repo>/.git` exists, runs pull.
- Otherwise clones from GitHub (token-authenticated URL when token available).
- Sets execution context working directory to `repo_path`.
- Requires literal string config values (no template resolution in this node).

## Example

```json
{
  "owner": "acme",
  "repo": "my-repo",
  "path": "/tmp/repos"
}
```
