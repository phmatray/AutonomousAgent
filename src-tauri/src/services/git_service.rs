use crate::errors::{AppError, Result};
use git2::Repository;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub is_clean: bool,
    pub modified: Vec<String>,
    pub staged: Vec<String>,
    pub untracked: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLogEntry {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
}

pub struct GitService;

#[allow(dead_code)]
impl GitService {
    pub fn new() -> Self {
        Self
    }

    // --- git2-rs fast operations ---

    pub fn status(&self, repo_path: &str) -> Result<GitStatus> {
        let repo = Repository::open(repo_path)?;

        let head = repo.head().ok();
        let branch = head
            .as_ref()
            // git2 0.21 : `Reference::shorthand()` rend un `Result<&str, Error>` la ou la
            // 0.20 rendait un `Option<&str>` (elle faisait le `.ok()` en interne).
            // `.ok()` conserve donc la semantique d'origine : un shorthand indisponible
            // retombe sur "HEAD" juste en dessous, il ne remonte pas d'erreur.
            // NE PAS suivre la suggestion de rustc (`Some(...)`) : elle type-checke mais
            // produit un Option<Result<..>>, et un shorthand en echec deviendrait un
            // Some(Err) au lieu du repli.
            .and_then(|h| h.shorthand().ok().map(String::from))
            .unwrap_or_else(|| "HEAD".to_string());

        let statuses = repo.statuses(None)?;

        let mut modified = Vec::new();
        let mut staged = Vec::new();
        let mut untracked = Vec::new();

        for entry in statuses.iter() {
            let path = entry.path().unwrap_or("").to_string();
            let status = entry.status();

            if status.contains(git2::Status::WT_MODIFIED)
                || status.contains(git2::Status::WT_RENAMED)
                || status.contains(git2::Status::WT_DELETED)
            {
                modified.push(path.clone());
            }
            if status.contains(git2::Status::INDEX_NEW)
                || status.contains(git2::Status::INDEX_MODIFIED)
                || status.contains(git2::Status::INDEX_DELETED)
                || status.contains(git2::Status::INDEX_RENAMED)
            {
                staged.push(path.clone());
            }
            if status.contains(git2::Status::WT_NEW) {
                untracked.push(path);
            }
        }

        let is_clean = modified.is_empty() && staged.is_empty() && untracked.is_empty();

        Ok(GitStatus {
            branch,
            is_clean,
            modified,
            staged,
            untracked,
        })
    }

    pub fn log(&self, repo_path: &str, max_count: usize) -> Result<Vec<GitLogEntry>> {
        let repo = Repository::open(repo_path)?;

        let mut revwalk = repo.revwalk()?;
        revwalk.push_head()?;

        let mut entries = Vec::new();
        for (i, oid) in revwalk.enumerate() {
            if i >= max_count {
                break;
            }
            let oid = oid?;
            let commit = repo.find_commit(oid)?;
            let author = commit.author();

            entries.push(GitLogEntry {
                sha: oid.to_string(),
                message: commit.message().unwrap_or("").trim().to_string(),
                author: author.name().unwrap_or("unknown").to_string(),
                date: chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default(),
            });
        }

        Ok(entries)
    }

    pub fn diff_summary(&self, repo_path: &str) -> Result<String> {
        let repo = Repository::open(repo_path)?;
        let head = repo.head()?;
        let tree = head.peel_to_tree()?;
        let diff = repo.diff_tree_to_workdir(Some(&tree), None)?;
        let stats = diff.stats()?;

        Ok(format!(
            "{} files changed, {} insertions(+), {} deletions(-)",
            stats.files_changed(),
            stats.insertions(),
            stats.deletions()
        ))
    }

    pub fn get_head_sha(&self, repo_path: &str) -> Result<String> {
        let repo = Repository::open(repo_path)?;
        let head = repo.head()?;
        let commit = head.peel_to_commit()?;
        Ok(commit.id().to_string())
    }

    // --- Git CLI for worktree and branch operations ---

    pub async fn create_worktree(
        &self,
        repo_path: &str,
        worktree_path: &str,
        branch_name: &str,
    ) -> Result<()> {
        let output = Command::new("git")
            .args(["worktree", "add", "-b", branch_name, worktree_path])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to create worktree: {}",
                stderr
            ))));
        }

        Ok(())
    }

    pub async fn list_worktrees(&self, repo_path: &str) -> Result<Vec<WorktreeInfo>> {
        let output = Command::new("git")
            .args(["worktree", "list", "--porcelain"])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to list worktrees: {}",
                stderr
            ))));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut worktrees = Vec::new();
        let mut current_path = String::new();
        let mut current_branch = String::new();

        for line in stdout.lines() {
            if let Some(path) = line.strip_prefix("worktree ") {
                current_path = path.to_string();
            } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
                current_branch = branch.to_string();
            } else if line.is_empty() && !current_path.is_empty() {
                worktrees.push(WorktreeInfo {
                    path: current_path.clone(),
                    branch: current_branch.clone(),
                });
                current_path.clear();
                current_branch.clear();
            }
        }

        // Capture the last entry if there was no trailing newline
        if !current_path.is_empty() {
            worktrees.push(WorktreeInfo {
                path: current_path,
                branch: current_branch,
            });
        }

        Ok(worktrees)
    }

    pub async fn remove_worktree(&self, repo_path: &str, worktree_path: &str) -> Result<()> {
        let output = Command::new("git")
            .args(["worktree", "remove", "--force", worktree_path])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to remove worktree: {}",
                stderr
            ))));
        }

        Ok(())
    }

    pub async fn checkout_branch(&self, repo_path: &str, branch_name: &str) -> Result<()> {
        let output = Command::new("git")
            .args(["checkout", branch_name])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to checkout branch: {}",
                stderr
            ))));
        }

        Ok(())
    }

    pub async fn create_branch(&self, repo_path: &str, branch_name: &str) -> Result<()> {
        let output = Command::new("git")
            .args(["checkout", "-b", branch_name])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to create branch: {}",
                stderr
            ))));
        }

        Ok(())
    }

    pub async fn add_all(&self, repo_path: &str) -> Result<()> {
        let output = Command::new("git")
            .args(["add", "-A"])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to stage files: {}",
                stderr
            ))));
        }

        Ok(())
    }

    pub async fn commit(&self, repo_path: &str, message: &str) -> Result<String> {
        let output = Command::new("git")
            .args(["commit", "-m", message])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to commit: {}",
                stderr
            ))));
        }

        // Return the new HEAD SHA
        self.get_head_sha(repo_path)
    }

    pub async fn push(&self, repo_path: &str, branch_name: &str) -> Result<()> {
        let output = Command::new("git")
            .args(["push", "-u", "origin", branch_name])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to push: {}",
                stderr
            ))));
        }

        Ok(())
    }

    pub async fn pull(&self, repo_path: &str) -> Result<()> {
        let output = Command::new("git")
            .args(["pull"])
            .current_dir(repo_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to pull: {}",
                stderr
            ))));
        }

        Ok(())
    }

    pub async fn clone_repo(&self, url: &str, target_path: &str) -> Result<()> {
        let output = Command::new("git")
            .args(["clone", url, target_path])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(git2::Error::from_str(&format!(
                "Failed to clone: {}",
                stderr
            ))));
        }

        Ok(())
    }

    /// Generate a gitflow-compliant branch name
    pub fn gitflow_branch_name(branch_type: &str, name: &str) -> String {
        let sanitized = name
            .to_lowercase()
            .replace(' ', "-")
            .replace(|c: char| !c.is_alphanumeric() && c != '-', "");
        match branch_type {
            "feature" => format!("feature/{}", sanitized),
            "hotfix" => format!("hotfix/{}", sanitized),
            "release" => format!("release/{}", sanitized),
            _ => format!("feature/{}", sanitized),
        }
    }

    /// Build a conventional commit message with gitmoji
    pub fn conventional_commit(
        commit_type: &str,
        scope: Option<&str>,
        description: &str,
        gitmoji: Option<&str>,
    ) -> String {
        let emoji = gitmoji.unwrap_or(match commit_type {
            "feat" => "✨",
            "fix" => "🐛",
            "docs" => "📝",
            "style" => "💄",
            "refactor" => "♻️",
            "perf" => "⚡",
            "test" => "✅",
            "build" => "🏗️",
            "ci" => "👷",
            "chore" => "🔧",
            _ => "🔨",
        });

        let scope_part = scope.map(|s| format!("({})", s)).unwrap_or_default();

        format!("{} {}{}: {}", emoji, commit_type, scope_part, description)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gitflow_branch_name_feature() {
        let name = GitService::gitflow_branch_name("feature", "add login page");
        assert_eq!(name, "feature/add-login-page");
    }

    #[test]
    fn test_gitflow_branch_name_hotfix() {
        let name = GitService::gitflow_branch_name("hotfix", "Fix #42 bug");
        assert_eq!(name, "hotfix/fix-42-bug");
    }

    #[test]
    fn test_gitflow_branch_name_special_chars() {
        let name = GitService::gitflow_branch_name("feature", "auth/oauth2.0!");
        assert_eq!(name, "feature/authoauth20");
    }

    #[test]
    fn test_gitflow_branch_name_unknown_type() {
        let name = GitService::gitflow_branch_name("unknown", "my thing");
        assert_eq!(name, "feature/my-thing");
    }

    #[test]
    fn test_conventional_commit_feat() {
        let msg = GitService::conventional_commit("feat", None, "add login", None);
        assert!(msg.starts_with("✨"));
        assert!(msg.contains("feat: add login"));
    }

    #[test]
    fn test_conventional_commit_with_scope() {
        let msg = GitService::conventional_commit("fix", Some("auth"), "token refresh", None);
        assert!(msg.contains("fix(auth): token refresh"));
    }

    #[test]
    fn test_conventional_commit_custom_gitmoji() {
        let msg = GitService::conventional_commit("feat", None, "add login", Some("🚀"));
        assert!(msg.starts_with("🚀"));
        assert!(msg.contains("feat: add login"));
    }

    #[test]
    fn test_conventional_commit_all_types() {
        let types = vec![
            ("feat", "✨"),
            ("fix", "🐛"),
            ("docs", "📝"),
            ("style", "💄"),
            ("perf", "⚡"),
            ("test", "✅"),
            ("chore", "🔧"),
        ];
        for (commit_type, expected_emoji) in types {
            let msg = GitService::conventional_commit(commit_type, None, "test", None);
            assert!(
                msg.starts_with(expected_emoji),
                "Expected '{}' to start with {} for type {}",
                msg,
                expected_emoji,
                commit_type
            );
        }
    }
}
