use keyring::{Entry, Error as KeyringError};

pub(crate) trait SecretBackend {
    fn load(&self) -> Result<Option<String>, String>;
    fn save(&self, secret: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

struct OsKeychain;

impl OsKeychain {
    fn entry() -> Result<Entry, String> {
        Entry::new("dev.scadmill.app", "ai-api-key")
            .map_err(|error| format!("Could not open the operating system keychain: {error}"))
    }
}

impl SecretBackend for OsKeychain {
    fn load(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(format!(
                "Could not read the AI key from the keychain: {error}"
            )),
        }
    }

    fn save(&self, secret: &str) -> Result<(), String> {
        Self::entry()?
            .set_password(secret)
            .map_err(|error| format!("Could not save the AI key in the keychain: {error}"))
    }

    fn clear(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
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
pub(crate) async fn load_ai_secret() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| load_secret(&OsKeychain))
        .await
        .map_err(|error| format!("Keychain task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn save_ai_secret(secret: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_secret(&OsKeychain, &secret))
        .await
        .map_err(|error| format!("Keychain task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn clear_ai_secret() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| clear_secret(&OsKeychain))
        .await
        .map_err(|error| format!("Keychain task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{SecretBackend, clear_secret, load_secret, save_secret};
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
}
