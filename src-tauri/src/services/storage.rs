use crate::errors::{AppError, Result};
use serde::{Deserialize, Serialize};

const SERVICE_NAME: &str = "autonomous-agent";
const GITHUB_TOKEN_KEY: &str = "github_token";
const GITHUB_CREDENTIAL_INDEX_KEY: &str = "github_credentials_index";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubCredential {
    pub id: String,
    pub username: String,
    pub label: String,
    pub is_default: bool,
}

pub struct StorageService;

#[allow(dead_code)]
impl StorageService {
    fn token_key_for_credential(credential_id: &str) -> String {
        format!("github_token_{}", credential_id)
    }

    fn normalize_credential_id(raw: &str) -> String {
        let normalized = raw
            .trim()
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>()
            .trim_matches('-')
            .to_string();

        if normalized.is_empty() {
            "github-account".to_string()
        } else {
            normalized
        }
    }

    fn load_credential_index(&self) -> Result<Vec<GitHubCredential>> {
        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_CREDENTIAL_INDEX_KEY)?;
        match entry.get_password() {
            Ok(raw) => serde_json::from_str(&raw).map_err(AppError::from),
            Err(keyring::Error::NoEntry) => Ok(Vec::new()),
            Err(e) => Err(AppError::Authentication(format!(
                "Failed to read credential index: {}",
                e
            ))),
        }
    }

    fn save_credential_index(&self, credentials: &[GitHubCredential]) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_CREDENTIAL_INDEX_KEY)?;
        let payload = serde_json::to_string(credentials)?;
        entry.set_password(&payload).map_err(|e| {
            AppError::Authentication(format!("Failed to store credential index: {}", e))
        })
    }

    fn normalize_default_flags(credentials: &mut [GitHubCredential]) -> bool {
        if credentials.is_empty() {
            return false;
        }

        let mut first_default: Option<usize> = None;
        let mut changed = false;

        for (idx, credential) in credentials.iter_mut().enumerate() {
            if credential.is_default {
                if first_default.is_none() {
                    first_default = Some(idx);
                } else {
                    credential.is_default = false;
                    changed = true;
                }
            }
        }

        if first_default.is_none() {
            credentials[0].is_default = true;
            changed = true;
        }

        changed
    }

    fn credential_has_token(&self, credential_id: &str) -> Result<bool> {
        let key = Self::token_key_for_credential(credential_id);
        let entry = keyring::Entry::new(SERVICE_NAME, &key)?;
        match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(other) => Err(AppError::Authentication(format!(
                "Failed to retrieve token: {}",
                other
            ))),
        }
    }

    pub fn new() -> Self {
        Self
    }

    pub fn save_github_credential(&self, username: &str, token: &str) -> Result<GitHubCredential> {
        let username = username.trim();
        if username.is_empty() {
            return Err(AppError::Validation(
                "GitHub username cannot be empty".to_string(),
            ));
        }

        let token = token.trim();
        if token.is_empty() {
            return Err(AppError::Validation(
                "GitHub token cannot be empty".to_string(),
            ));
        }

        let credential_id = Self::normalize_credential_id(username);
        let token_key = Self::token_key_for_credential(&credential_id);
        let token_entry = keyring::Entry::new(SERVICE_NAME, &token_key)?;
        token_entry.set_password(token).map_err(|e| {
            AppError::Authentication(format!("Failed to store token in keyring: {}", e))
        })?;

        let mut credentials = self.load_credential_index()?;
        let mut found = false;

        for credential in &mut credentials {
            if credential.id == credential_id {
                credential.username = username.to_string();
                credential.label = username.to_string();
                credential.is_default = true;
                found = true;
            } else {
                credential.is_default = false;
            }
        }

        if !found {
            credentials.push(GitHubCredential {
                id: credential_id.clone(),
                username: username.to_string(),
                label: username.to_string(),
                is_default: true,
            });
        }

        self.save_credential_index(&credentials)?;

        credentials
            .into_iter()
            .find(|c| c.id == credential_id)
            .ok_or_else(|| AppError::Unknown("Credential was not persisted".to_string()))
    }

    pub fn list_github_credentials(&self) -> Result<Vec<GitHubCredential>> {
        let credentials = self.load_credential_index()?;
        let mut cleaned = Vec::with_capacity(credentials.len());
        let mut changed = false;

        for credential in credentials {
            if self.credential_has_token(&credential.id)? {
                cleaned.push(credential);
            } else {
                changed = true;
            }
        }

        changed |= Self::normalize_default_flags(&mut cleaned);

        if changed {
            self.save_credential_index(&cleaned)?;
        }

        Ok(cleaned)
    }

    pub fn get_github_token_for_credential(&self, credential_id: &str) -> Result<String> {
        let credential_id = credential_id.trim();
        if credential_id.is_empty() {
            return Err(AppError::Validation(
                "credential_id cannot be empty".to_string(),
            ));
        }

        let key = Self::token_key_for_credential(credential_id);
        let entry = keyring::Entry::new(SERVICE_NAME, &key)?;
        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => AppError::Authentication(format!(
                "No GitHub token found for credential '{}'",
                credential_id
            )),
            other => AppError::Authentication(format!("Failed to retrieve token: {}", other)),
        })
    }

    pub fn get_default_github_token(&self) -> Result<String> {
        let credentials = self.list_github_credentials().unwrap_or_default();
        if let Some(default_credential) =
            credentials.iter().find(|credential| credential.is_default)
        {
            if let Ok(token) = self.get_github_token_for_credential(&default_credential.id) {
                return Ok(token);
            }
        }

        for credential in &credentials {
            if let Ok(token) = self.get_github_token_for_credential(&credential.id) {
                return Ok(token);
            }
        }

        // Backward compatibility for legacy single-token installations.
        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_TOKEN_KEY)?;
        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => {
                AppError::Authentication("No GitHub token found".to_string())
            }
            other => AppError::Authentication(format!("Failed to retrieve token: {}", other)),
        })
    }

    pub fn get_github_token_for_credential_or_default(
        &self,
        credential_id: Option<&str>,
    ) -> Result<String> {
        match credential_id {
            Some(id) if !id.trim().is_empty() => self.get_github_token_for_credential(id.trim()),
            _ => self.get_default_github_token(),
        }
    }

    pub fn set_github_token(&self, token: &str) -> Result<()> {
        let token = token.trim();
        if token.is_empty() {
            return Err(AppError::Validation(
                "GitHub token cannot be empty".to_string(),
            ));
        }

        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_TOKEN_KEY)?;
        entry.set_password(token).map_err(|e| {
            AppError::Authentication(format!("Failed to store token in keyring: {}", e))
        })
    }

    pub fn get_github_token(&self) -> Result<String> {
        self.get_default_github_token()
    }

    pub fn delete_github_token(&self) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_TOKEN_KEY)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // Already deleted
            Err(e) => Err(AppError::Authentication(format!(
                "Failed to delete token: {}",
                e
            ))),
        }
    }

    pub fn has_github_token(&self) -> bool {
        self.get_github_token().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::{GitHubCredential, StorageService};

    fn credential(id: &str, is_default: bool) -> GitHubCredential {
        GitHubCredential {
            id: id.to_string(),
            username: id.to_string(),
            label: id.to_string(),
            is_default,
        }
    }

    #[test]
    fn normalize_default_flags_sets_first_as_default_when_missing() {
        let mut credentials = vec![credential("alice", false), credential("bob", false)];
        let changed = StorageService::normalize_default_flags(&mut credentials);

        assert!(changed);
        assert!(credentials[0].is_default);
        assert!(!credentials[1].is_default);
    }

    #[test]
    fn normalize_default_flags_keeps_single_default() {
        let mut credentials = vec![credential("alice", false), credential("bob", true)];
        let changed = StorageService::normalize_default_flags(&mut credentials);

        assert!(!changed);
        assert!(!credentials[0].is_default);
        assert!(credentials[1].is_default);
    }

    #[test]
    fn normalize_default_flags_resets_multiple_defaults() {
        let mut credentials = vec![
            credential("alice", true),
            credential("bob", true),
            credential("carol", true),
        ];
        let changed = StorageService::normalize_default_flags(&mut credentials);

        assert!(changed);
        assert!(credentials[0].is_default);
        assert!(!credentials[1].is_default);
        assert!(!credentials[2].is_default);
    }
}
