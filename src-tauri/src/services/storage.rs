use crate::errors::{AppError, Result};

const SERVICE_NAME: &str = "autonomous-agent";
const GITHUB_TOKEN_KEY: &str = "github_token";

pub struct StorageService;

#[allow(dead_code)]
impl StorageService {
    pub fn new() -> Self {
        Self
    }

    pub fn set_github_token(&self, token: &str) -> Result<()> {
        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_TOKEN_KEY)?;
        entry.set_password(token).map_err(|e| {
            AppError::Authentication(format!("Failed to store token in keyring: {}", e))
        })
    }

    pub fn get_github_token(&self) -> Result<String> {
        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_TOKEN_KEY)?;
        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => {
                AppError::Authentication("No GitHub token found".to_string())
            }
            other => AppError::Authentication(format!("Failed to retrieve token: {}", other)),
        })
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
