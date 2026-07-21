use base64::Engine as _;
use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_3MF_BYTES: usize = 512 * 1024 * 1024;
static HANDOFF_NONCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SlicerHandoffWire {
    slicer_name: String,
    temporary_file: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SlicerExecutable {
    name: String,
    path: PathBuf,
}

fn slicer_name(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Configured slicer");
    let normalized = stem.to_ascii_lowercase();
    if normalized.contains("prusa") {
        "PrusaSlicer".to_string()
    } else if normalized.contains("orca") {
        "OrcaSlicer".to_string()
    } else if normalized.contains("cura") {
        "Cura".to_string()
    } else if normalized.contains("bambu") {
        "Bambu Studio".to_string()
    } else {
        stem.chars().take(128).collect()
    }
}

fn select_slicer(
    configured_path: Option<&str>,
    detected: impl IntoIterator<Item = PathBuf>,
    is_file: impl Fn(&Path) -> bool,
) -> Result<SlicerExecutable, String> {
    if let Some(configured) = configured_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(configured);
        if !path.is_absolute() {
            return Err("The configured slicer executable path must be absolute.".to_string());
        }
        if !is_file(&path) {
            return Err("The configured slicer executable was not found.".to_string());
        }
        return Ok(SlicerExecutable {
            name: slicer_name(&path),
            path,
        });
    }
    detected
        .into_iter()
        .find(|path| is_file(path))
        .map(|path| SlicerExecutable {
            name: slicer_name(&path),
            path,
        })
        .ok_or_else(|| {
            "No supported slicer was detected. Configure a slicer executable and try again."
                .to_string()
        })
}

fn append_prefixed_install_paths(
    paths: &mut Vec<PathBuf>,
    root: &Path,
    prefix: &str,
    executable: &str,
) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let normalized_prefix = prefix.to_ascii_lowercase();
    for entry in entries.flatten().take(128) {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        if name.starts_with(&normalized_prefix) {
            paths.push(entry.path().join(executable));
        }
    }
}

fn detected_slicer_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for root in [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
    ]
    .into_iter()
    .flatten()
    .map(PathBuf::from)
    {
        paths.push(root.join("Prusa3D/PrusaSlicer/prusa-slicer.exe"));
        paths.push(root.join("OrcaSlicer/orca-slicer.exe"));
        paths.push(root.join("UltiMaker Cura/UltiMaker-Cura.exe"));
        paths.push(root.join("Bambu Studio/bambu-studio.exe"));
        append_prefixed_install_paths(
            &mut paths,
            &root.join("Prusa3D"),
            "PrusaSlicer",
            "prusa-slicer.exe",
        );
        append_prefixed_install_paths(&mut paths, &root, "UltiMaker Cura", "UltiMaker-Cura.exe");
    }
    if let Some(root) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        paths.push(root.join("Programs/PrusaSlicer/prusa-slicer.exe"));
        paths.push(root.join("Programs/OrcaSlicer/orca-slicer.exe"));
        paths.push(root.join("Programs/UltiMaker Cura/UltiMaker-Cura.exe"));
        paths.push(root.join("Programs/Bambu Studio/bambu-studio.exe"));
    }
    paths
}

fn safe_3mf_name(suggested_name: &str) -> String {
    let leaf = suggested_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("model.3mf");
    let mut safe = leaf
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '-'
            } else {
                character
            }
        })
        .take(240)
        .collect::<String>();
    safe = safe.trim().trim_end_matches(['.', ' ']).to_string();
    if safe.is_empty() {
        return "model.3mf".to_string();
    }
    if !safe.to_ascii_lowercase().ends_with(".3mf") {
        safe.push_str(".3mf");
    }
    safe
}

fn cleanup_old_handoffs(folder: &Path) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten().take(256) {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("3mf") {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
            .is_ok_and(|age| age > Duration::from_secs(7 * 24 * 60 * 60));
        if old {
            let _ = fs::remove_file(path);
        }
    }
}

fn write_handoff_in(folder: &Path, suggested_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(folder)
        .map_err(|error| format!("Could not create the slicer handoff folder: {error}"))?;
    cleanup_old_handoffs(folder);
    let safe_name = safe_3mf_name(suggested_name);
    let stem = safe_name.strip_suffix(".3mf").unwrap_or("model");
    for _ in 0..128 {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "The system clock cannot create a slicer handoff.".to_string())?
            .as_millis();
        let nonce = HANDOFF_NONCE.fetch_add(1, Ordering::Relaxed);
        let path = folder.join(format!(
            "{stem}-{timestamp}-{}-{nonce}.3mf",
            std::process::id()
        ));
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
                    let _ = fs::remove_file(&path);
                    return Err(format!("Could not write the slicer handoff file: {error}"));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create the slicer handoff file: {error}")),
        }
    }
    Err("Could not allocate a unique slicer handoff file.".to_string())
}

fn open_in_slicer_blocking(
    suggested_name: &str,
    contents_base64: &str,
    configured_executable_path: Option<&str>,
) -> Result<SlicerHandoffWire, String> {
    let slicer = select_slicer(
        configured_executable_path,
        detected_slicer_paths(),
        Path::is_file,
    )?;
    if contents_base64.len() > (MAX_3MF_BYTES / 3 + 1) * 4 {
        return Err("The encoded 3MF handoff exceeds the 512 MiB limit.".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| format!("The 3MF handoff data is not valid base64: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_3MF_BYTES {
        return Err("The 3MF handoff must contain between 1 byte and 512 MiB.".to_string());
    }
    let folder = std::env::temp_dir().join("ScadMill").join("slicer-handoff");
    let temporary_file = write_handoff_in(&folder, suggested_name, &bytes)?;
    let launch = Command::new(&slicer.path)
        .arg(&temporary_file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if let Err(error) = launch {
        let _ = fs::remove_file(&temporary_file);
        return Err(format!("Could not launch {}: {error}", slicer.name));
    }
    let temporary_file = temporary_file
        .canonicalize()
        .unwrap_or(temporary_file)
        .to_string_lossy()
        .into_owned();
    Ok(SlicerHandoffWire {
        slicer_name: slicer.name,
        temporary_file,
    })
}

#[tauri::command]
pub(crate) async fn open_in_slicer(
    suggested_name: String,
    contents_base64: String,
    configured_executable_path: Option<String>,
) -> Result<SlicerHandoffWire, String> {
    tauri::async_runtime::spawn_blocking(move || {
        open_in_slicer_blocking(
            &suggested_name,
            &contents_base64,
            configured_executable_path.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("Slicer handoff task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_folder() -> PathBuf {
        std::env::temp_dir().join(format!(
            "scadmill-slicer-handoff-test-{}-{}",
            std::process::id(),
            HANDOFF_NONCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn configured_slicer_wins_and_must_be_absolute() {
        let configured = if cfg!(windows) {
            r"C:\Tools\orca-slicer.exe"
        } else {
            "/opt/orca-slicer"
        };
        let selected = select_slicer(Some(configured), [PathBuf::from("detected")], |path| {
            path == Path::new(configured)
        })
        .expect("configured slicer");
        assert_eq!(selected.name, "OrcaSlicer");
        assert_eq!(
            select_slicer(Some("relative.exe"), [], |_| true).unwrap_err(),
            "The configured slicer executable path must be absolute."
        );
    }

    #[test]
    fn detection_uses_the_first_existing_supported_candidate() {
        let candidates = [
            PathBuf::from("missing-prusa-slicer.exe"),
            PathBuf::from("bambu-studio.exe"),
        ];
        let selected = select_slicer(None, candidates.clone(), |path| path == candidates[1])
            .expect("detected slicer");
        assert_eq!(selected.name, "Bambu Studio");
        assert_eq!(selected.path, candidates[1]);
    }

    #[test]
    fn writes_a_unique_sanitized_3mf_without_overwriting() {
        let folder = temp_folder();
        let first = write_handoff_in(&folder, "../wheel?.3mf", b"first").expect("first");
        let second = write_handoff_in(&folder, "../wheel?.3mf", b"second").expect("second");
        assert_ne!(first, second);
        assert_eq!(fs::read(first).expect("first bytes"), b"first");
        assert_eq!(fs::read(second).expect("second bytes"), b"second");
        fs::remove_dir_all(folder).expect("cleanup");
    }

    #[test]
    fn discovers_bounded_versioned_install_folders() {
        let root = temp_folder();
        fs::create_dir_all(root.join("UltiMaker Cura 6.2")).expect("versioned folder");
        fs::create_dir_all(root.join("Unrelated")).expect("unrelated folder");
        let mut paths = Vec::new();
        append_prefixed_install_paths(&mut paths, &root, "UltiMaker Cura", "UltiMaker-Cura.exe");
        assert_eq!(paths, [root.join("UltiMaker Cura 6.2/UltiMaker-Cura.exe")]);
        fs::remove_dir_all(root).expect("cleanup");
    }
}
