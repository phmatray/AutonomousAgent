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

        let page = client
            .issues(owner, repo)
            .list()
            .state(octocrab::params::State::Open)
            .per_page(30)
            .send()
            .await
            .map_err(|e| AppError::GitHub(format!("Failed to list issues: {}", e)))?;

        let issues = page
            .items
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
            .collect();

        Ok(issues)
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
