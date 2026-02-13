# `github.createPR` Node

## Summary

Creates a pull request in a GitHub repository.

## Configuration

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `owner` | string | Yes | - | GitHub repository owner. Supports templates. |
| `repo` | string | Yes | - | GitHub repository name. Supports templates. |
| `title` | string | Yes | - | Pull request title. Supports templates. |
| `body` | string | No | `""` | Pull request description/body. Supports templates. |
| `head` | string | Yes | - | Source branch name. Supports templates. |
| `base` | string | No | `develop` | Target branch name. Supports templates. |
| `credential_id` | string | No | default credential/session | Credential selector used for auth. |

## Output

```json
{
  "number": 42,
  "html_url": "https://github.com/acme/my-repo/pull/42",
  "title": "feat: add workflow docs"
}
```

## Behavior

- Resolves templates before execution.
- Requires authentication (token or active session).
- Calls GitHub API to create the PR and returns metadata.

## Example

```json
{
  "owner": "{{github.sync.owner}}",
  "repo": "{{github.sync.repo}}",
  "title": "feat: add standardized node docs",
  "body": "Adds README docs for all workflow nodes.",
  "head": "feature/node-docs",
  "base": "develop"
}
```
