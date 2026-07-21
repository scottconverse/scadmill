use futures_util::StreamExt;
use scadmill_native_engine::engine_version;
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use super::{bundled_engine_candidate, find_native_engine, native_engine_build_identity};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstalledEngineWire {
    version: String,
    executable_path: String,
    sha256: String,
    source: &'static str,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OfficialEngineReleaseWire {
    id: &'static str,
    version: &'static str,
    platform: &'static str,
    archive_sha256: &'static str,
}

struct OfficialEngineRelease {
    wire: OfficialEngineReleaseWire,
    url: &'static str,
    executable_sha256: &'static str,
}

const WINDOWS_PINNED_RELEASE: OfficialEngineRelease = OfficialEngineRelease {
    wire: OfficialEngineReleaseWire {
        id: "windows-2026.06.12-x86_64",
        version: "2026.06.12",
        platform: "Windows x86-64",
        archive_sha256: "3AA51474EA66609FB3FAFA4AA7F2AB4B6FE3FF50C130184F11BBE3818F3EF5AA",
    },
    url: "https://files.openscad.org/snapshots/OpenSCAD-2026.06.12-x86-64.zip",
    executable_sha256: "DE9A0C732C23C3FEB0B49CF938777AA0AEE3E206DB9E98571672CACC4816C524",
};
const MAX_ENGINE_ARCHIVE_BYTES: usize = 512 * 1024 * 1024;

fn executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "openscad.exe"
    } else {
        "openscad"
    }
}

fn engine_record(path: PathBuf, source: &'static str) -> Option<InstalledEngineWire> {
    let canonical = path.canonicalize().ok()?;
    let version = engine_version(&canonical).ok()?;
    let identity = native_engine_build_identity(&canonical).ok()?;
    let sha256 = identity
        .strip_prefix("native:sha256:")?
        .to_ascii_uppercase();
    Some(InstalledEngineWire {
        version,
        executable_path: canonical.to_string_lossy().into_owned(),
        sha256,
        source,
    })
}

fn release_for_id(release_id: &str) -> Option<&'static OfficialEngineRelease> {
    if cfg!(target_os = "windows") && release_id == WINDOWS_PINNED_RELEASE.wire.id {
        Some(&WINDOWS_PINNED_RELEASE)
    } else {
        None
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:X}", Sha256::digest(bytes))
}

fn verify_archive(bytes: &[u8], release: &OfficialEngineRelease) -> Result<(), String> {
    if bytes.len() > MAX_ENGINE_ARCHIVE_BYTES {
        return Err("The official OpenSCAD archive exceeds the 512 MiB limit.".to_string());
    }
    let actual = sha256_hex(bytes);
    if actual != release.wire.archive_sha256 {
        return Err(format!(
            "Official OpenSCAD archive checksum mismatch: expected {}, received {actual}.",
            release.wire.archive_sha256
        ));
    }
    Ok(())
}

fn find_executable(root: &Path) -> Result<PathBuf, String> {
    let mut pending = vec![root.to_path_buf()];
    let mut visited = 0_usize;
    while let Some(directory) = pending.pop() {
        let entries = fs::read_dir(&directory)
            .map_err(|error| format!("Could not inspect the OpenSCAD archive: {error}"))?;
        for entry in entries {
            let entry = entry
                .map_err(|error| format!("Could not inspect the OpenSCAD archive: {error}"))?;
            visited += 1;
            if visited > 4096 {
                return Err("The OpenSCAD archive contains too many entries.".to_string());
            }
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Could not inspect the OpenSCAD archive: {error}"))?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(executable_name())
            {
                return Ok(path);
            }
        }
    }
    Err("The official OpenSCAD archive contains no engine executable.".to_string())
}

#[cfg(target_os = "windows")]
fn extract_archive(archive: &Path, destination: &Path) -> Result<(), String> {
    let status = Command::new("powershell.exe")
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
        .arg("Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force")
        .arg(archive)
        .arg(destination)
        .status()
        .map_err(|error| format!("Could not start the Windows archive extractor: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "The Windows archive extractor failed with status {status}."
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn extract_archive(_archive: &Path, _destination: &Path) -> Result<(), String> {
    Err("Official engine installation is currently available in the Windows beta only.".to_string())
}

fn install_downloaded_archive(
    app: &AppHandle,
    release: &'static OfficialEngineRelease,
    bytes: &[u8],
) -> Result<InstalledEngineWire, String> {
    verify_archive(bytes, release)?;
    let engines = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate ScadMill application data: {error}"))?
        .join("engines");
    fs::create_dir_all(&engines)
        .map_err(|error| format!("Could not create the managed-engine folder: {error}"))?;
    let final_directory = engines.join(release.wire.version);
    let final_executable = final_directory.join(executable_name());
    if final_executable.is_file() {
        return validate_installed_release(final_executable, release);
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let staging = engines.join(format!(
        ".install-{}-{}-{nonce}",
        release.wire.version,
        std::process::id()
    ));
    let result = (|| {
        let expanded = staging.join("expanded");
        fs::create_dir_all(&expanded)
            .map_err(|error| format!("Could not create the engine staging folder: {error}"))?;
        let archive = staging.join("openscad.zip");
        fs::write(&archive, bytes)
            .map_err(|error| format!("Could not stage the OpenSCAD archive: {error}"))?;
        extract_archive(&archive, &expanded)?;
        let executable = find_executable(&expanded)?;
        validate_installed_release(executable.clone(), release)?;
        let source_directory = executable
            .parent()
            .ok_or_else(|| "The extracted engine folder is invalid.".to_string())?;
        fs::rename(source_directory, &final_directory)
            .map_err(|error| format!("Could not install the OpenSCAD engine: {error}"))?;
        validate_installed_release(final_executable, release)
    })();
    let _ = fs::remove_dir_all(&staging);
    result
}

fn validate_installed_release(
    executable: PathBuf,
    release: &OfficialEngineRelease,
) -> Result<InstalledEngineWire, String> {
    let bytes = fs::read(&executable)
        .map_err(|error| format!("Could not read the installed OpenSCAD executable: {error}"))?;
    let actual_hash = sha256_hex(&bytes);
    if actual_hash != release.executable_sha256 {
        return Err(
            "The installed OpenSCAD executable checksum does not match the official build."
                .to_string(),
        );
    }
    let version = engine_version(&executable).map_err(|error| error.to_string())?;
    if version != release.wire.version {
        return Err(format!(
            "The installed OpenSCAD version is {version}, not {}.",
            release.wire.version
        ));
    }
    Ok(InstalledEngineWire {
        version,
        executable_path: executable
            .canonicalize()
            .map_err(|error| {
                format!("Could not resolve the installed OpenSCAD executable: {error}")
            })?
            .to_string_lossy()
            .into_owned(),
        sha256: actual_hash,
        source: "managed",
    })
}

fn managed_candidates(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .take(128)
        .map(|entry| entry.path().join(executable_name()))
        .filter(|path| path.is_file())
        .collect()
}

fn list_installed_blocking(
    app: &AppHandle,
    configured_engine_path: Option<&str>,
) -> Vec<InstalledEngineWire> {
    let mut candidates = Vec::new();
    if let Ok(root) = app.path().app_data_dir() {
        candidates.extend(
            managed_candidates(&root.join("engines"))
                .into_iter()
                .map(|path| (path, "managed")),
        );
    }
    if let Some(path) = configured_engine_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        candidates.push((PathBuf::from(path), "configured"));
    }
    if let Some(path) = bundled_engine_candidate(app).filter(|path| path.is_file()) {
        candidates.push((path, "bundled"));
    }
    if let Ok(path) = find_native_engine(app, configured_engine_path, None) {
        candidates.push((path, "discovered"));
    }
    let mut seen = BTreeSet::new();
    let mut records = candidates
        .into_iter()
        .filter_map(|(path, source)| {
            let record = engine_record(path, source)?;
            if seen.insert(record.executable_path.to_ascii_lowercase()) {
                Some(record)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    records.sort_by(|left, right| {
        left.version
            .cmp(&right.version)
            .then(left.executable_path.cmp(&right.executable_path))
    });
    records
}

#[tauri::command]
pub(crate) async fn engine_manager_list(
    app: AppHandle,
    configured_engine_path: Option<String>,
) -> Result<Vec<InstalledEngineWire>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_installed_blocking(&app, configured_engine_path.as_deref())
    })
    .await
    .map_err(|error| format!("Engine version inventory failed: {error}"))
}

#[tauri::command]
pub(crate) fn engine_manager_official_releases() -> Vec<OfficialEngineReleaseWire> {
    if cfg!(target_os = "windows") {
        vec![WINDOWS_PINNED_RELEASE.wire]
    } else {
        Vec::new()
    }
}

#[tauri::command]
pub(crate) async fn engine_manager_install_official(
    app: AppHandle,
    release_id: String,
) -> Result<InstalledEngineWire, String> {
    let release = release_for_id(&release_id).ok_or_else(|| {
        "That official OpenSCAD release is not allow-listed by this build.".to_string()
    })?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("Could not prepare the engine downloader: {error}"))?;
    let response = client
        .get(release.url)
        .header(
            reqwest::header::USER_AGENT,
            "ScadMill engine version manager",
        )
        .send()
        .await
        .map_err(|error| format!("Official OpenSCAD download failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Official OpenSCAD download failed with HTTP {}.",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ENGINE_ARCHIVE_BYTES as u64)
    {
        return Err("The official OpenSCAD archive exceeds the 512 MiB limit.".to_string());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| format!("Could not read the official OpenSCAD download: {error}"))?;
        let expanded = bytes
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "The official OpenSCAD archive is too large.".to_string())?;
        if expanded > MAX_ENGINE_ARCHIVE_BYTES {
            return Err("The official OpenSCAD archive exceeds the 512 MiB limit.".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    tauri::async_runtime::spawn_blocking(move || install_downloaded_archive(&app, release, &bytes))
        .await
        .map_err(|error| format!("Engine installation failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_scan_is_bounded_to_direct_version_folders() {
        let root =
            std::env::temp_dir().join(format!("scadmill-engine-list-{}", std::process::id()));
        let version = root.join("X");
        fs::create_dir_all(&version).expect("version folder");
        fs::write(version.join(executable_name()), b"engine").expect("engine fixture");
        fs::create_dir_all(root.join("Y/nested")).expect("nested folder");
        fs::write(root.join("Y/nested").join(executable_name()), b"nested")
            .expect("nested fixture");
        assert_eq!(managed_candidates(&root), [version.join(executable_name())]);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn official_catalog_is_exact_and_unknown_ids_are_rejected() {
        let releases = engine_manager_official_releases();
        if cfg!(target_os = "windows") {
            assert_eq!(releases.len(), 1);
            assert_eq!(
                releases[0].archive_sha256,
                WINDOWS_PINNED_RELEASE.wire.archive_sha256
            );
            assert!(release_for_id("untrusted").is_none());
            assert!(verify_archive(b"not the official archive", &WINDOWS_PINNED_RELEASE).is_err());
        } else {
            assert!(releases.is_empty());
        }
    }
}
