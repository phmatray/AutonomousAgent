use crate::errors::{AppError, Result};
use octocrab::Octocrab;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubRepo {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub owner: String,
    pub description: Option<String>,
    pub default_branch: String,
    pub private: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubIssue {
    pub number: i64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GithubUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequestInfo {
    pub number: i64,
    pub html_url: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequestDetails {
    pub number: i64,
    pub html_url: String,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub draft: bool,
    pub author: Option<String>,
    pub head_branch: String,
    pub base_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullRequestComment {
    pub id: i64,
    pub html_url: String,
    pub body: String,
}

pub struct GitHubClient {
    client: Arc<RwLock<Option<Octocrab>>>,
    authenticated_user: Arc<RwLock<Option<GithubUser>>>,
}

#[allow(dead_code)]
impl GitHubClient {
    pub fn new() -> Self {
        Self {
            client: Arc::new(RwLock::new(None)),
            authenticated_user: Arc::new(RwLock::new(None)),
        }
    }

    /// Create a lightweight handle that shares the same internal state.
    /// Useful for passing into async tasks that outlive borrows.
    pub fn clone_for_restore(&self) -> Self {
        Self {
            client: Arc::clone(&self.client),
            authenticated_user: Arc::clone(&self.authenticated_user),
        }
    }

    pub async fn authenticate(&self, token: &str) -> Result<GithubUser> {
        let octocrab = Octocrab::builder()
            .personal_token(token.to_string())
            .build()
            .map_err(|e| AppError::GitHub(format!("Failed to build client: {}", e)))?;

        // Verify authentication by fetching current user
        let user = octocrab
            .current()
            .user()
            .await
            .map_err(|e| AppError::Authentication(format!("Invalid token: {}", e)))?;

        let github_user = GithubUser {
            login: user.login.clone(),
            name: None,
            avatar_url: user.avatar_url.to_string(),
        };

        *self.client.write().await = Some(octocrab);
        *self.authenticated_user.write().await = Some(github_user.clone());

        Ok(github_user)
    }

    pub async fn get_authenticated_user(&self) -> Result<GithubUser> {
        self.authenticated_user
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Authentication("Not authenticated".to_string()))
    }

    pub async fn clear_authentication(&self) {
        *self.client.write().await = None;
        *self.authenticated_user.write().await = None;
    }

    async fn get_client(&self) -> Result<Octocrab> {
        self.client
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Authentication("Not authenticated with GitHub".to_string()))
    }

    pub async fn list_repositories(&self) -> Result<Vec<GithubRepo>> {
        let client = self.get_client().await?;

        let page = client
            .current()
            .list_repos_for_authenticated_user()
            .sort("updated")
            .per_page(50)
            .send()
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to list repos: {}", e)))?;

        let repos = page
            .items
            .into_iter()
            .map(|repo| {
                let owner = repo
                    .owner
                    .as_ref()
                    .map(|o| o.login.clone())
                    .unwrap_or_default();
                GithubRepo {
                    id: repo.id.into_inner() as i64,
                    name: repo.name.clone(),
                    full_name: repo
                        .full_name
                        .unwrap_or_else(|| format!("{}/{}", owner, repo.name)),
                    owner,
                    description: repo.description,
                    default_branch: repo.default_branch.unwrap_or_else(|| "main".to_string()),
                    private: repo.private.unwrap_or(false),
                }
            })
            .collect();

        Ok(repos)
    }

    pub async fn list_issues(&self, owner: &str, repo: &str) -> Result<Vec<GithubIssue>> {
        let client = self.get_client().await?;

        let mut page = client
            .issues(owner, repo)
            .list()
            .state(octocrab::params::State::Open)
            .per_page(100)
            .send()
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to list issues: {}", e)))?;

        let mut issues = Vec::new();

        loop {
            issues.extend(Self::normalize_issues(page.items));
            let next_page = page.next.clone();
            if next_page.is_some() {
                page = client
                    .get_page(&next_page)
                    .await
                    .map_err(|e| AppError::GitHub(format!("Failed to list issues: {}", e)))?
                    .ok_or_else(|| {
                        AppError::GitHub("Unexpected empty GitHub issues page".to_string())
                    })?;
            } else {
                break;
            }
        }

        Ok(issues)
    }

    fn normalize_issues(issues: Vec<octocrab::models::issues::Issue>) -> Vec<GithubIssue> {
        issues
            .into_iter()
            // Filter out pull requests (they also appear in the issues endpoint)
            .filter(|issue| issue.pull_request.is_none())
            .map(|issue| GithubIssue {
                number: issue.number as i64,
                title: issue.title,
                body: issue.body,
                state: format!("{:?}", issue.state).to_lowercase(),
                labels: issue.labels.iter().map(|l| l.name.clone()).collect(),
                assignees: issue.assignees.iter().map(|a| a.login.clone()).collect(),
            })
            .collect()
    }

    pub async fn create_branch(
        &self,
        owner: &str,
        repo: &str,
        branch_name: &str,
        from_sha: &str,
    ) -> Result<()> {
        let client = self.get_client().await?;
        let route = format!("/repos/{}/{}/git/refs", owner, repo);

        let _: serde_json::Value = client
            .post(
                route,
                Some(&serde_json::json!({
                    "ref": format!("refs/heads/{}", branch_name),
                    "sha": from_sha
                })),
            )
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to create branch: {}", e)))?;

        Ok(())
    }

    pub async fn create_pull_request(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
        head: &str,
        base: &str,
    ) -> Result<PullRequestInfo> {
        let client = self.get_client().await?;

        let pr = client
            .pulls(owner, repo)
            .create(title, head, base)
            .body(body)
            .send()
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to create PR: {}", e)))?;

        Ok(PullRequestInfo {
            number: pr.number as i64,
            html_url: pr.html_url.map(|u| u.to_string()).unwrap_or_default(),
            title: pr.title.unwrap_or_default(),
        })
    }

    pub async fn get_default_branch_sha(&self, owner: &str, repo: &str) -> Result<String> {
        let client = self.get_client().await?;

        let repo_info = client
            .repos(owner, repo)
            .get()
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to get repo: {}", e)))?;

        let default_branch = repo_info
            .default_branch
            .unwrap_or_else(|| "main".to_string());

        let route = format!("/repos/{}/{}/git/ref/heads/{}", owner, repo, default_branch);

        let reference: serde_json::Value = client
            .get(route, None::<&()>)
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to get branch ref: {}", e)))?;

        let sha = reference["object"]["sha"]
            .as_str()
            .ok_or_else(|| AppError::GitHub("Missing SHA in ref response".to_string()))?
            .to_string();

        Ok(sha)
    }

    pub async fn get_pull_request(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
    ) -> Result<PullRequestDetails> {
        let client = self.get_client().await?;
        let route = format!("/repos/{}/{}/pulls/{}", owner, repo, pr_number);

        let pr: serde_json::Value = client
            .get(route, None::<&()>)
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to get pull request: {}", e)))?;

        let title = pr["title"]
            .as_str()
            .ok_or_else(|| AppError::GitHub("Missing pull request title".to_string()))?
            .to_string();

        Ok(PullRequestDetails {
            number: pr["number"].as_i64().unwrap_or(pr_number),
            html_url: pr["html_url"].as_str().unwrap_or_default().to_string(),
            title,
            body: pr["body"].as_str().map(|value| value.to_string()),
            state: pr["state"].as_str().unwrap_or("open").to_string(),
            draft: pr["draft"].as_bool().unwrap_or(false),
            author: pr["user"]["login"].as_str().map(|value| value.to_string()),
            head_branch: pr["head"]["ref"].as_str().unwrap_or_default().to_string(),
            base_branch: pr["base"]["ref"].as_str().unwrap_or_default().to_string(),
        })
    }

    pub async fn create_pull_request_comment(
        &self,
        owner: &str,
        repo: &str,
        pr_number: i64,
        body: &str,
    ) -> Result<PullRequestComment> {
        let body = body.trim();
        if body.is_empty() {
            return Err(AppError::Validation(
                "Pull request comment body cannot be empty".to_string(),
            ));
        }

        let client = self.get_client().await?;
        let route = format!("/repos/{}/{}/issues/{}/comments", owner, repo, pr_number);

        let response: serde_json::Value = client
            .post(route, Some(&serde_json::json!({ "body": body })))
            .await
            .map_err(|e| {
                AppError::GitHub(format!("Failed to create pull request comment: {}", e))
            })?;

        let id = response["id"]
            .as_i64()
            .ok_or_else(|| AppError::GitHub("Missing comment ID in GitHub response".to_string()))?;

        Ok(PullRequestComment {
            id,
            html_url: response["html_url"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            body: response["body"].as_str().unwrap_or(body).to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::GitHubClient;
    use octocrab::models::issues::Issue;
    use serde_json::{json, Value};

    // `octocrab::models::issues::Issue` est #[non_exhaustive] : il ne peut etre construit
    // que par deserialisation, et depuis octocrab 0.49 tous ses champs non optionnels sont
    // obligatoires (`id`, `node_id`, les 6 URLs, `user`, `locked`, `comments`, les dates).
    // Ces fabriques portent ce remplissage obligatoire pour que le test reste centre sur
    // les seuls champs que `normalize_issues` consomme.
    fn author_json(login: &str) -> Value {
        json!({
            "login": login,
            "id": 1,
            "node_id": "MDQ6VXNlcjE=",
            "avatar_url": "https://avatars.githubusercontent.com/u/1",
            "gravatar_id": "",
            "url": "https://api.github.com/users/o",
            "html_url": "https://github.com/o",
            "followers_url": "https://api.github.com/users/o/followers",
            "following_url": "https://api.github.com/users/o/following",
            "gists_url": "https://api.github.com/users/o/gists",
            "starred_url": "https://api.github.com/users/o/starred",
            "subscriptions_url": "https://api.github.com/users/o/subscriptions",
            "organizations_url": "https://api.github.com/users/o/orgs",
            "repos_url": "https://api.github.com/users/o/repos",
            "events_url": "https://api.github.com/users/o/events",
            "received_events_url": "https://api.github.com/users/o/received_events",
            "type": "User",
            "site_admin": false,
            "name": null,
            "patch_url": null
        })
    }

    fn label_json(name: &str) -> Value {
        json!({
            "id": 1,
            "node_id": "MDU6TGFiZWwx",
            "url": "https://api.github.com/repos/o/r/labels/name",
            "name": name,
            "color": "a2eeef",
            "default": false
        })
    }

    fn issue_json(number: u64, title: &str) -> Value {
        json!({
            "id": number,
            "node_id": "MDU6SXNzdWUx",
            "url": format!("https://api.github.com/repos/o/r/issues/{number}"),
            "repository_url": "https://api.github.com/repos/o/r",
            "labels_url": format!("https://api.github.com/repos/o/r/issues/{number}/labels"),
            "comments_url": format!("https://api.github.com/repos/o/r/issues/{number}/comments"),
            "events_url": format!("https://api.github.com/repos/o/r/issues/{number}/events"),
            "html_url": format!("https://github.com/o/r/issues/{number}"),
            "number": number,
            "state": "open",
            "title": title,
            "body": null,
            "user": author_json("octocat"),
            "labels": [],
            "assignees": [],
            "locked": false,
            "comments": 0,
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z"
        })
    }

    #[test]
    fn normalize_issues_filters_pull_requests_and_maps_fields() {
        let mut issue_payload = issue_json(7, "Enhance issue sync");
        issue_payload["body"] = json!("Load all pages");
        issue_payload["labels"] = json!([label_json("enhancement")]);
        issue_payload["assignees"] = json!([author_json("alice")]);

        let mut pull_request_payload = issue_json(8, "PR should be filtered");
        pull_request_payload["pull_request"] = json!({
            "url": "https://api.github.com/repos/o/r/pulls/8",
            "html_url": "https://github.com/o/r/pull/8",
            "diff_url": "https://github.com/o/r/pull/8.diff",
            "patch_url": "https://github.com/o/r/pull/8.patch"
        });

        let issues: Vec<Issue> = vec![
            serde_json::from_value(issue_payload).expect("valid issue payload"),
            serde_json::from_value(pull_request_payload).expect("valid pull request payload"),
        ];

        let normalized = GitHubClient::normalize_issues(issues);
        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].number, 7);
        assert_eq!(normalized[0].title, "Enhance issue sync");
        assert_eq!(normalized[0].labels, vec!["enhancement"]);
        assert_eq!(normalized[0].assignees, vec!["alice"]);
        assert_eq!(normalized[0].state, "open");
    }
}
