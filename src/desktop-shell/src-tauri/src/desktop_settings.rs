use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE_NAME: &str = "settings-v1.json";
const SETTINGS_SIZE_LIMIT: u64 = 1_048_576;

fn replace_existing_settings(
    path: &Path,
    temporary: &Path,
    rename_file: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
    let backup = path.with_extension("json.backup");
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("Could not clear the previous settings backup: {error}"))?;
    }
    rename_file(path, &backup)
        .map_err(|error| format!("Could not preserve existing settings: {error}"))?;
    match rename_file(temporary, path) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(install_error) => match rename_file(&backup, path) {
            Ok(()) => Err(format!("Could not install settings: {install_error}")),
            Err(rollback_error) => Err(format!(
                "Could not install settings: {install_error}; previous settings remain in the backup because rollback failed: {rollback_error}"
            )),
        },
    }
}

pub(crate) fn load_settings_file(path: &Path) -> Result<Option<String>, String> {
    let mut readable_path = path.to_path_buf();
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let backup = path.with_extension("json.backup");
            let metadata = match fs::metadata(&backup) {
                Ok(metadata) => metadata,
                Err(backup_error) if backup_error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(None);
                }
                Err(backup_error) => {
                    return Err(format!("Could not inspect settings backup: {backup_error}"));
                }
            };
            if fs::rename(&backup, path).is_err() {
                readable_path = backup;
            }
            metadata
        }
        Err(error) => return Err(format!("Could not inspect settings: {error}")),
    };
    if metadata.len() > SETTINGS_SIZE_LIMIT {
        return Err("Settings exceed the supported size.".to_string());
    }
    fs::read_to_string(readable_path)
        .map(Some)
        .map_err(|error| format!("Could not read settings: {error}"))
}

pub(crate) fn save_settings_file(path: &Path, serialized: &str) -> Result<(), String> {
    if serialized.len() as u64 > SETTINGS_SIZE_LIMIT {
        return Err("Settings exceed the supported size.".to_string());
    }
    let parsed: Value =
        serde_json::from_str(serialized).map_err(|_| "Settings are not valid JSON.".to_string())?;
    if parsed.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("Settings do not use the supported version.".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Settings path has no parent directory.".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create settings folder: {error}"))?;
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("Could not create temporary settings: {error}"))?;
    file.write_all(serialized.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("Could not write settings: {error}"))?;
    drop(file);
    if cfg!(target_os = "windows") && path.exists() {
        return replace_existing_settings(path, &temporary, |from, to| fs::rename(from, to));
    }
    fs::rename(&temporary, path).map_err(|error| format!("Could not install settings: {error}"))
}

pub(crate) fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("Could not locate the platform config directory: {error}"))
}

#[tauri::command]
pub(crate) fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    load_settings_file(&settings_path(&app)?)
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn save_settings(app: AppHandle, serialized_settings: String) -> Result<(), String> {
    save_settings_file(&settings_path(&app)?, &serialized_settings)
}

#[cfg(test)]
mod tests {
    use super::{load_settings_file, replace_existing_settings, save_settings_file};
    use std::io::{Error, ErrorKind};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_settings_path() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("scadmill-settings-{}-{nonce}", std::process::id()))
            .join("settings-v1.json")
    }

    #[test]
    fn settings_round_trip_through_one_platform_config_file() {
        let path = temp_settings_path();
        let serialized = "{\"version\":1}\n";

        save_settings_file(&path, serialized).expect("save settings");

        assert_eq!(
            load_settings_file(&path).expect("load settings"),
            Some(serialized.to_string())
        );
        std::fs::remove_dir_all(path.parent().expect("settings parent")).expect("cleanup");
    }

    #[test]
    fn oversized_settings_are_rejected_without_writing_a_file() {
        let path = temp_settings_path();

        let error = save_settings_file(&path, &"x".repeat(1_048_577))
            .expect_err("oversized settings must fail");

        assert_eq!(error, "Settings exceed the supported size.");
        assert!(!path.exists());
    }

    #[test]
    fn failed_replacement_restores_the_previous_settings_file() {
        let path = temp_settings_path();
        let parent = path.parent().expect("settings parent");
        let temporary = path.with_extension("replacement.tmp");
        std::fs::create_dir_all(parent).expect("create settings parent");
        std::fs::write(&path, "old-settings").expect("write old settings");
        std::fs::write(&temporary, "new-settings").expect("write replacement settings");

        let error = replace_existing_settings(&path, &temporary, |from, to| {
            if from == temporary && to == path {
                Err(Error::new(
                    ErrorKind::PermissionDenied,
                    "simulated install failure",
                ))
            } else {
                std::fs::rename(from, to)
            }
        })
        .expect_err("the simulated replacement must fail");

        assert!(error.contains("simulated install failure"));
        assert_eq!(
            std::fs::read_to_string(&path).ok().as_deref(),
            Some("old-settings")
        );
        assert_eq!(
            std::fs::read_to_string(&temporary).ok().as_deref(),
            Some("new-settings")
        );
        std::fs::remove_dir_all(parent).expect("cleanup");
    }

    #[test]
    fn load_recovers_a_backup_left_by_an_interrupted_replacement() {
        let path = temp_settings_path();
        let parent = path.parent().expect("settings parent");
        let backup = path.with_extension("json.backup");
        std::fs::create_dir_all(parent).expect("create settings parent");
        std::fs::write(&backup, "{\"version\":1}\n").expect("write backup settings");

        assert_eq!(
            load_settings_file(&path).expect("recover settings"),
            Some("{\"version\":1}\n".to_string())
        );
        assert!(path.exists());
        assert!(!backup.exists());
        std::fs::remove_dir_all(parent).expect("cleanup");
    }
}
