use base64::Engine as _;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const ARTIFACT_SIZE_LIMIT: usize = 512 * 1024 * 1024;

fn reserved_windows_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "AUX" | "CLOCK$" | "CON" | "CONIN$" | "CONOUT$" | "NUL" | "PRN"
    ) || ((stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem[3..]
            .parse::<u8>()
            .is_ok_and(|number| (1..=9).contains(&number)))
}

fn sanitize_artifact_name(suggested_name: &str) -> String {
    let leaf = suggested_name
        .split(['/', '\\'])
        .next_back()
        .unwrap_or_default();
    let mut portable = leaf
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    portable = portable.trim().trim_end_matches(['.', ' ']).to_string();
    if portable.is_empty() {
        return "artifact.bin".to_string();
    }
    if reserved_windows_name(&portable) {
        portable.insert(0, '_');
    }
    portable
}

fn collision_name(name: &str, ordinal: usize) -> String {
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact");
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => format!("{stem} ({ordinal}).{extension}"),
        None => format!("{stem} ({ordinal})"),
    }
}

pub(crate) fn save_artifact_in(
    folder: &Path,
    suggested_name: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    if bytes.len() > ARTIFACT_SIZE_LIMIT {
        return Err("Artifact exceeds the supported size.".to_string());
    }
    fs::create_dir_all(folder)
        .map_err(|error| format!("Could not create the artifact destination: {error}"))?;
    let name = sanitize_artifact_name(suggested_name);
    for ordinal in 1..=10_000 {
        let candidate_name = if ordinal == 1 {
            name.clone()
        } else {
            collision_name(&name, ordinal)
        };
        let candidate = folder.join(candidate_name);
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create artifact file: {error}")),
        };
        if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&candidate);
            return Err(format!("Could not write artifact file: {error}"));
        }
        return Ok(candidate);
    }
    Err("Could not allocate a unique artifact file name.".to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn save_artifact(
    app: AppHandle,
    suggested_name: String,
    contents_base64: String,
) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| format!("Artifact payload is not valid base64: {error}"))?;
    let folder = app
        .path()
        .download_dir()
        .map_err(|error| format!("Could not locate the Downloads folder: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        save_artifact_in(&folder, &suggested_name, &bytes)
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| format!("Artifact save task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_folder() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let folder = std::env::temp_dir().join(format!("scadmill-artifacts-{nonce}"));
        fs::create_dir_all(&folder).expect("create temp folder");
        folder
    }

    #[test]
    fn sanitizes_untrusted_suggested_names() {
        assert_eq!(
            sanitize_artifact_name("../cube:preview?.png"),
            "cube-preview-.png"
        );
        assert_eq!(sanitize_artifact_name("CON.png"), "_CON.png");
        assert_eq!(sanitize_artifact_name("..."), "artifact.bin");
    }

    #[test]
    fn saves_without_overwriting_an_existing_download() {
        let folder = temp_folder();
        fs::write(folder.join("cube.png"), b"old").expect("fixture");

        let location = save_artifact_in(&folder, "cube.png", b"new").expect("save");

        assert_eq!(fs::read(folder.join("cube.png")).expect("old"), b"old");
        assert_eq!(fs::read(&location).expect("new"), b"new");
        assert_eq!(
            location.file_name().and_then(|name| name.to_str()),
            Some("cube (2).png")
        );
        fs::remove_dir_all(folder).expect("cleanup");
    }
}
