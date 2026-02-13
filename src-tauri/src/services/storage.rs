use crate::errors::{AppError, Result};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqlitePool;
use sqlx::Row;
use std::sync::Arc;
use tokio::sync::RwLock;

const SERVICE_NAME: &str = "autonomous-agent";
const DB_ENCRYPTION_KEY_KEYRING_KEY: &str = "db_encryption_key";

const GITHUB_TOKEN_KEY: &str = "github_token";
const GITHUB_CREDENTIAL_INDEX_KEY: &str = "github_credentials_index";

const DB_KEY_GITHUB_CREDENTIAL_INDEX: &str = "credentials.github.index";
const DB_KEY_GITHUB_LEGACY_TOKEN: &str = "credentials.github.legacy_token";
const DB_KEY_CLAUDE_API_KEY: &str = "credentials.claude.api_key";
const DB_KEY_CLAUDE_ACCOUNT_LABEL: &str = "credentials.claude.account_label";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubCredential {
    pub id: String,
    pub username: String,
    pub label: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCredentialStatus {
    pub configured: bool,
    pub account_label: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StorageService {
    db_pool_handle: Arc<RwLock<Option<SqlitePool>>>,
}

#[allow(dead_code)]
impl StorageService {
    pub fn new() -> Self {
        Self {
            db_pool_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub fn with_db_pool_handle(db_pool_handle: Arc<RwLock<Option<SqlitePool>>>) -> Self {
        Self { db_pool_handle }
    }

    fn token_key_for_credential(credential_id: &str) -> String {
        format!("credentials.github.token.{}", credential_id)
    }

    fn legacy_token_key_for_credential(credential_id: &str) -> String {
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

    async fn db_pool(&self) -> Result<SqlitePool> {
        self.db_pool_handle
            .read()
            .await
            .clone()
            .ok_or_else(|| AppError::Database {
                code: crate::errors::types::ErrorCode::DatabaseNotInitialized.as_str(),
                message: "Database not initialized".to_string(),
            })
    }

    fn encrypt_secret(&self, plaintext: &str) -> Result<String> {
        let key = self.load_or_create_encryption_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| {
            AppError::Authentication(format!("Failed to initialize encryption key: {}", e))
        })?;

        let mut nonce_bytes = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
            .map_err(|e| AppError::Authentication(format!("Failed to encrypt secret: {}", e)))?;

        let mut payload = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
        payload.extend_from_slice(&nonce_bytes);
        payload.extend_from_slice(&ciphertext);

        Ok(BASE64.encode(payload))
    }

    fn decrypt_secret(&self, encoded_payload: &str) -> Result<String> {
        let payload = BASE64.decode(encoded_payload).map_err(|e| {
            AppError::Authentication(format!("Stored secret is not valid base64: {}", e))
        })?;

        if payload.len() < 13 {
            return Err(AppError::Authentication(
                "Stored secret payload is invalid".to_string(),
            ));
        }

        let (nonce_bytes, ciphertext) = payload.split_at(12);
        let key = self.load_or_create_encryption_key()?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| {
            AppError::Authentication(format!("Failed to initialize decryption key: {}", e))
        })?;

        let plaintext = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|e| AppError::Authentication(format!("Failed to decrypt secret: {}", e)))?;

        String::from_utf8(plaintext)
            .map_err(|e| AppError::Authentication(format!("Secret is not valid UTF-8: {}", e)))
    }

    fn load_or_create_encryption_key(&self) -> Result<[u8; 32]> {
        let entry = keyring::Entry::new(SERVICE_NAME, DB_ENCRYPTION_KEY_KEYRING_KEY)?;

        match entry.get_password() {
            Ok(raw_key) => {
                let decoded = BASE64.decode(raw_key).map_err(|e| {
                    AppError::Authentication(format!("Stored encryption key is invalid: {}", e))
                })?;

                if decoded.len() != 32 {
                    return Err(AppError::Authentication(
                        "Stored encryption key has invalid length".to_string(),
                    ));
                }

                let mut key = [0u8; 32];
                key.copy_from_slice(&decoded);
                Ok(key)
            }
            Err(keyring::Error::NoEntry) => {
                let mut key = [0u8; 32];
                rand::rngs::OsRng.fill_bytes(&mut key);
                let encoded = BASE64.encode(key);

                entry.set_password(&encoded).map_err(|e| {
                    AppError::Authentication(format!("Failed to store encryption key: {}", e))
                })?;

                Ok(key)
            }
            Err(other) => Err(AppError::Authentication(format!(
                "Failed to access encryption key: {}",
                other
            ))),
        }
    }

    async fn get_config_entry(&self, key: &str) -> Result<Option<(String, bool)>> {
        let pool = self.db_pool().await?;
        let row = sqlx::query("SELECT value, encrypted FROM config WHERE key = ?")
            .bind(key)
            .fetch_optional(&pool)
            .await?;

        Ok(row.map(|row| {
            let value = row.get::<String, _>("value");
            let encrypted = row.get::<bool, _>("encrypted");
            (value, encrypted)
        }))
    }

    async fn set_config_entry(&self, key: &str, value: &str, encrypted: bool) -> Result<()> {
        let pool = self.db_pool().await?;
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            "INSERT INTO config (key, value, encrypted, updated_at) VALUES (?, ?, ?, ?)\
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(encrypted)
        .bind(now)
        .execute(&pool)
        .await?;

        Ok(())
    }

    async fn delete_config_entry(&self, key: &str) -> Result<()> {
        let pool = self.db_pool().await?;
        sqlx::query("DELETE FROM config WHERE key = ?")
            .bind(key)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn load_credential_index(&self) -> Result<Vec<GitHubCredential>> {
        if let Some((raw, _)) = self
            .get_config_entry(DB_KEY_GITHUB_CREDENTIAL_INDEX)
            .await?
        {
            serde_json::from_str(&raw).map_err(AppError::from)
        } else {
            Ok(Vec::new())
        }
    }

    async fn save_credential_index(&self, credentials: &[GitHubCredential]) -> Result<()> {
        let payload = serde_json::to_string(credentials)?;
        self.set_config_entry(DB_KEY_GITHUB_CREDENTIAL_INDEX, &payload, false)
            .await
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

    async fn credential_has_token(&self, credential_id: &str) -> Result<bool> {
        let key = Self::token_key_for_credential(credential_id);
        Ok(self.get_config_entry(&key).await?.is_some())
    }

    async fn try_migrate_legacy_keyring_github_credentials(&self) -> Result<()> {
        if self
            .get_config_entry(DB_KEY_GITHUB_CREDENTIAL_INDEX)
            .await?
            .is_some()
        {
            return Ok(());
        }

        let index_entry = keyring::Entry::new(SERVICE_NAME, GITHUB_CREDENTIAL_INDEX_KEY)?;
        let mut migrated_credentials: Vec<GitHubCredential> = match index_entry.get_password() {
            Ok(raw_index) => serde_json::from_str(&raw_index).unwrap_or_default(),
            Err(keyring::Error::NoEntry) => Vec::new(),
            Err(err) => {
                return Err(AppError::Authentication(format!(
                    "Failed to read legacy keyring credential index: {}",
                    err
                )));
            }
        };

        if migrated_credentials.is_empty() {
            let legacy_entry = keyring::Entry::new(SERVICE_NAME, GITHUB_TOKEN_KEY)?;
            match legacy_entry.get_password() {
                Ok(token) => {
                    let id = "github-default".to_string();
                    let encrypted = self.encrypt_secret(&token)?;
                    self.set_config_entry(&Self::token_key_for_credential(&id), &encrypted, true)
                        .await?;
                    migrated_credentials.push(GitHubCredential {
                        id,
                        username: "github".to_string(),
                        label: "Default GitHub account".to_string(),
                        is_default: true,
                    });
                }
                Err(keyring::Error::NoEntry) => {}
                Err(err) => {
                    return Err(AppError::Authentication(format!(
                        "Failed to read legacy GitHub token: {}",
                        err
                    )));
                }
            }
        } else {
            let mut valid_credentials = Vec::new();
            for credential in migrated_credentials {
                let legacy_key = Self::legacy_token_key_for_credential(&credential.id);
                let token_entry = keyring::Entry::new(SERVICE_NAME, &legacy_key)?;
                match token_entry.get_password() {
                    Ok(token) => {
                        let encrypted = self.encrypt_secret(&token)?;
                        self.set_config_entry(
                            &Self::token_key_for_credential(&credential.id),
                            &encrypted,
                            true,
                        )
                        .await?;
                        valid_credentials.push(credential);
                    }
                    Err(keyring::Error::NoEntry) => {}
                    Err(err) => {
                        return Err(AppError::Authentication(format!(
                            "Failed to read legacy credential token '{}': {}",
                            credential.id, err
                        )));
                    }
                }
            }
            migrated_credentials = valid_credentials;
        }

        if !migrated_credentials.is_empty() {
            Self::normalize_default_flags(&mut migrated_credentials);
            self.save_credential_index(&migrated_credentials).await?;
        }

        Ok(())
    }

    pub async fn save_github_credential(
        &self,
        username: &str,
        token: &str,
    ) -> Result<GitHubCredential> {
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

        self.try_migrate_legacy_keyring_github_credentials().await?;

        let credential_id = Self::normalize_credential_id(username);
        let encrypted_token = self.encrypt_secret(token)?;
        self.set_config_entry(
            &Self::token_key_for_credential(&credential_id),
            &encrypted_token,
            true,
        )
        .await?;

        let mut credentials = self.load_credential_index().await?;
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

        self.save_credential_index(&credentials).await?;

        credentials
            .into_iter()
            .find(|c| c.id == credential_id)
            .ok_or_else(|| AppError::Unknown("Credential was not persisted".to_string()))
    }

    pub async fn list_github_credentials(&self) -> Result<Vec<GitHubCredential>> {
        self.try_migrate_legacy_keyring_github_credentials().await?;

        let credentials = self.load_credential_index().await?;
        let mut cleaned = Vec::with_capacity(credentials.len());
        let mut changed = false;

        for credential in credentials {
            if self.credential_has_token(&credential.id).await? {
                cleaned.push(credential);
            } else {
                changed = true;
            }
        }

        changed |= Self::normalize_default_flags(&mut cleaned);

        if changed {
            self.save_credential_index(&cleaned).await?;
        }

        Ok(cleaned)
    }

    pub async fn get_github_token_for_credential(&self, credential_id: &str) -> Result<String> {
        let credential_id = credential_id.trim();
        if credential_id.is_empty() {
            return Err(AppError::Validation(
                "credential_id cannot be empty".to_string(),
            ));
        }

        let key = Self::token_key_for_credential(credential_id);
        if let Some((value, encrypted)) = self.get_config_entry(&key).await? {
            return if encrypted {
                self.decrypt_secret(&value)
            } else {
                Ok(value)
            };
        }

        // Legacy fallback for users that did not migrate yet.
        let legacy_key = Self::legacy_token_key_for_credential(credential_id);
        let entry = keyring::Entry::new(SERVICE_NAME, &legacy_key)?;
        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => AppError::Authentication(format!(
                "No GitHub token found for credential '{}'",
                credential_id
            )),
            other => AppError::Authentication(format!("Failed to retrieve token: {}", other)),
        })
    }

    pub async fn get_default_github_token(&self) -> Result<String> {
        let credentials = self.list_github_credentials().await.unwrap_or_default();
        if let Some(default_credential) =
            credentials.iter().find(|credential| credential.is_default)
        {
            if let Ok(token) = self
                .get_github_token_for_credential(&default_credential.id)
                .await
            {
                return Ok(token);
            }
        }

        for credential in &credentials {
            if let Ok(token) = self.get_github_token_for_credential(&credential.id).await {
                return Ok(token);
            }
        }

        if let Some((value, encrypted)) = self.get_config_entry(DB_KEY_GITHUB_LEGACY_TOKEN).await? {
            return if encrypted {
                self.decrypt_secret(&value)
            } else {
                Ok(value)
            };
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

    pub async fn get_github_token_for_credential_or_default(
        &self,
        credential_id: Option<&str>,
    ) -> Result<String> {
        match credential_id {
            Some(id) if !id.trim().is_empty() => {
                self.get_github_token_for_credential(id.trim()).await
            }
            _ => self.get_default_github_token().await,
        }
    }

    pub async fn set_github_token(&self, token: &str) -> Result<()> {
        let token = token.trim();
        if token.is_empty() {
            return Err(AppError::Validation(
                "GitHub token cannot be empty".to_string(),
            ));
        }

        let encrypted_token = self.encrypt_secret(token)?;
        self.set_config_entry(DB_KEY_GITHUB_LEGACY_TOKEN, &encrypted_token, true)
            .await
    }

    pub async fn get_github_token(&self) -> Result<String> {
        self.get_default_github_token().await
    }

    pub async fn delete_github_token(&self) -> Result<()> {
        self.delete_config_entry(DB_KEY_GITHUB_LEGACY_TOKEN).await?;

        // Best-effort legacy cleanup.
        let entry = keyring::Entry::new(SERVICE_NAME, GITHUB_TOKEN_KEY)?;
        let _ = entry.delete_credential();

        Ok(())
    }

    pub async fn has_github_token(&self) -> bool {
        self.get_github_token().await.is_ok()
    }

    pub async fn save_claude_credential(
        &self,
        account_label: Option<&str>,
        api_key: &str,
    ) -> Result<ClaudeCredentialStatus> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(AppError::Validation(
                "Claude API key cannot be empty".to_string(),
            ));
        }

        let encrypted_api_key = self.encrypt_secret(api_key)?;
        self.set_config_entry(DB_KEY_CLAUDE_API_KEY, &encrypted_api_key, true)
            .await?;

        if let Some(label) = account_label {
            let trimmed = label.trim();
            if trimmed.is_empty() {
                self.delete_config_entry(DB_KEY_CLAUDE_ACCOUNT_LABEL)
                    .await?;
            } else {
                self.set_config_entry(DB_KEY_CLAUDE_ACCOUNT_LABEL, trimmed, false)
                    .await?;
            }
        }

        self.get_claude_credential_status().await
    }

    pub async fn get_claude_api_key(&self) -> Result<String> {
        let (value, encrypted) = self
            .get_config_entry(DB_KEY_CLAUDE_API_KEY)
            .await?
            .ok_or_else(|| AppError::Authentication("No Claude API key found".to_string()))?;

        if encrypted {
            self.decrypt_secret(&value)
        } else {
            Ok(value)
        }
    }

    pub async fn get_claude_credential_status(&self) -> Result<ClaudeCredentialStatus> {
        let account_label = self
            .get_config_entry(DB_KEY_CLAUDE_ACCOUNT_LABEL)
            .await?
            .map(|(value, _)| value)
            .and_then(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            });

        let configured = self
            .get_config_entry(DB_KEY_CLAUDE_API_KEY)
            .await?
            .is_some();

        Ok(ClaudeCredentialStatus {
            configured,
            account_label,
        })
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
