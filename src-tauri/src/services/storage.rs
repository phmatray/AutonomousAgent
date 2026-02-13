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

    pub fn new() -> Self {
        Self
    }

    pub fn save_github_credential(&self, username: &str, token: &str) -> Result<GitHubCredential> {
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
        self.load_credential_index()
    }

    pub fn get_github_token_for_credential(&self, credential_id: &str) -> Result<String> {
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
        let credentials = self.load_credential_index()?;
        if let Some(default_credential) = credentials
            .iter()
            .find(|credential| credential.is_default)
            .or_else(|| credentials.first())
        {
            return self.get_github_token_for_credential(&default_credential.id);
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
