use keyring::{Entry, Error as KeyringError};

pub(crate) trait SecretBackend {
    fn load(&self) -> Result<Option<String>, String>;
    fn save(&self, secret: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

const DEFAULT_PROFILE_ID: &str = "default";
const PROFILE_ID_LIMIT: usize = 128;
const LEGACY_ACCOUNT_NAME: &str = "ai-api-key";

fn normalized_profile_id(profile_id: Option<&str>) -> Result<Option<&str>, String> {
    match profile_id {
        None | Some(DEFAULT_PROFILE_ID) => Ok(None),
        Some(value)
            if !value.is_empty()
                && value.len() <= PROFILE_ID_LIMIT
                && value.bytes().enumerate().all(|(index, byte)| {
                    byte.is_ascii_alphanumeric()
                        || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
                }) =>
        {
            Ok(Some(value))
        }
        Some(_) => Err("AI secret scope is invalid.".to_string()),
    }
}

fn account_name(profile_id: Option<&str>) -> Result<String, String> {
    Ok(match normalized_profile_id(profile_id)? {
        Some(value) => format!("{LEGACY_ACCOUNT_NAME}:{value}"),
        None => LEGACY_ACCOUNT_NAME.to_string(),
    })
}

struct OsKeychain {
    account: String,
}

impl OsKeychain {
    fn new(profile_id: Option<&str>) -> Result<Self, String> {
        Ok(Self {
            account: account_name(profile_id)?,
        })
    }

    fn entry(&self) -> Result<Entry, String> {
        Entry::new("dev.scadmill.app", &self.account)
            .map_err(|error| format!("Could not open the operating system keychain: {error}"))
    }
}

impl SecretBackend for OsKeychain {
    fn load(&self) -> Result<Option<String>, String> {
        match self.entry()?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(format!(
                "Could not read the AI key from the keychain: {error}"
            )),
        }
    }

    fn save(&self, secret: &str) -> Result<(), String> {
        self.entry()?
            .set_password(secret)
            .map_err(|error| format!("Could not save the AI key in the keychain: {error}"))
    }

    fn clear(&self) -> Result<(), String> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!(
                "Could not clear the AI key from the keychain: {error}"
            )),
        }
    }
}

pub(crate) fn load_secret(backend: &impl SecretBackend) -> Result<String, String> {
    backend.load().map(|secret| secret.unwrap_or_default())
}

pub(crate) fn save_secret(backend: &impl SecretBackend, secret: &str) -> Result<(), String> {
    if secret.len() > 16_384 {
        return Err("AI secret exceeds the supported size.".to_string());
    }
    backend.save(secret)
}

fn clear_secret(backend: &impl SecretBackend) -> Result<(), String> {
    backend.clear()
}

#[tauri::command]
pub(crate) async fn load_ai_secret(profile_id: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let backend = OsKeychain::new(profile_id.as_deref())?;
        load_secret(&backend)
    })
    .await
    .map_err(|error| format!("Keychain task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_ai_secret(
    secret: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let backend = OsKeychain::new(profile_id.as_deref())?;
        save_secret(&backend, &secret)
    })
    .await
    .map_err(|error| format!("Keychain task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn clear_ai_secret(profile_id: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let backend = OsKeychain::new(profile_id.as_deref())?;
        clear_secret(&backend)
    })
    .await
    .map_err(|error| format!("Keychain task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{SecretBackend, account_name, clear_secret, load_secret, save_secret};
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryKeychain(Mutex<Option<String>>);

    impl SecretBackend for MemoryKeychain {
        fn load(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().expect("keychain lock").clone())
        }

        fn save(&self, secret: &str) -> Result<(), String> {
            *self.0.lock().expect("keychain lock") = Some(secret.to_string());
            Ok(())
        }

        fn clear(&self) -> Result<(), String> {
            *self.0.lock().expect("keychain lock") = None;
            Ok(())
        }
    }

    #[test]
    fn secret_round_trips_only_through_the_keychain_boundary() {
        let keychain = MemoryKeychain::default();

        save_secret(&keychain, "sentinel-secret").expect("save key");
        assert_eq!(load_secret(&keychain).expect("load key"), "sentinel-secret");
        clear_secret(&keychain).expect("clear key");
        assert_eq!(load_secret(&keychain).expect("load empty key"), "");
    }

    #[test]
    fn oversized_secret_is_rejected_before_the_keychain_boundary() {
        let keychain = MemoryKeychain::default();

        let error =
            save_secret(&keychain, &"x".repeat(16_385)).expect_err("oversized key must fail");

        assert_eq!(error, "AI secret exceeds the supported size.");
        assert_eq!(keychain.0.lock().expect("keychain lock").as_deref(), None);
    }

    #[test]
    fn scoped_accounts_are_isolated_and_default_uses_the_legacy_account() {
        assert_eq!(account_name(None).expect("default account"), "ai-api-key");
        assert_eq!(
            account_name(Some("default")).expect("named default account"),
            "ai-api-key"
        );
        assert_eq!(
            account_name(Some("provider-alpha")).expect("alpha account"),
            "ai-api-key:provider-alpha"
        );
        assert_eq!(
            account_name(Some("provider-beta")).expect("beta account"),
            "ai-api-key:provider-beta"
        );
    }

    #[test]
    fn invalid_or_oversized_scope_is_rejected_before_keychain_access() {
        for invalid in ["", "bad/scope"] {
            assert_eq!(
                account_name(Some(invalid)).expect_err("invalid scope must fail"),
                "AI secret scope is invalid."
            );
        }
        assert_eq!(
            account_name(Some(&"x".repeat(129))).expect_err("oversized scope must fail"),
            "AI secret scope is invalid."
        );
    }
}
