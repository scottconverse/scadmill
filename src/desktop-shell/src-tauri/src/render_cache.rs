use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const CACHE_DIRECTORY: &str = "render-cache-v1";
const MAX_RECORD_BYTES: u64 = 4 * 1024 * 1024;
const METADATA_RESERVE_BYTES: u64 = 256;
const CACHE_KEY_PREFIX: &str = "sha256:";
static CACHE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenderCacheRecordWire {
    pub(crate) key: String,
    pub(crate) byte_size: u64,
    pub(crate) last_access_ms: u64,
}

#[derive(Debug)]
struct CacheRecord {
    path: PathBuf,
    byte_size: u64,
    last_access_ms: u64,
}

fn hex_digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn valid_key(key: &str) -> bool {
    key.strip_prefix(CACHE_KEY_PREFIX).is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn valid_filename(filename: &str) -> bool {
    filename.len() == 64
        && filename
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn cache_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CACHE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Render cache lock failed".to_string())
}

fn cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join(CACHE_DIRECTORY))
        .map_err(|error| format!("Could not resolve render cache directory: {error}"))
}

fn record_path(app: &AppHandle, workspace_identity: &str, key: &str) -> Result<PathBuf, String> {
    if workspace_identity.is_empty() || !valid_key(key) {
        return Err("Invalid render cache identity or key".to_string());
    }
    let filename = key
        .strip_prefix(CACHE_KEY_PREFIX)
        .expect("validated cache key");
    Ok(cache_root(app)?
        .join(hex_digest(workspace_identity))
        .join(filename))
}

fn access_path(record: &Path) -> PathBuf {
    record.with_extension("meta")
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err("Render cache record exceeds the supported size".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Render cache path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create render cache directory: {error}"))?;
    let temporary = parent.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id()
    ));
    fs::write(&temporary, bytes)
        .map_err(|error| format!("Could not write render cache record: {error}"))?;
    if !cfg!(windows) {
        let _ = fs::File::open(&temporary).and_then(|file| file.sync_all());
    }
    if path.exists() {
        let backup = parent.join(format!(
            ".{}.bak",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup)
            .map_err(|error| format!("Could not preserve render cache record: {error}"))?;
        if let Err(error) = fs::rename(&temporary, path) {
            if let Err(rollback) = fs::rename(&backup, path) {
                let _ = fs::remove_file(&temporary);
                return Err(format!(
                    "Could not install render cache record: {error}; rollback failed: {rollback}"
                ));
            }
            let _ = fs::remove_file(&temporary);
            return Err(format!("Could not install render cache record: {error}"));
        }
        let _ = fs::remove_file(backup);
    } else if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not install render cache record: {error}"));
    }
    let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    Ok(())
}

fn cleanup_transaction_artifacts(directory: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Could not inspect render cache directory: {error}")),
    };
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not inspect render cache entry: {error}"))?;
        let filename = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let stale_sidecar = filename
            .strip_suffix(".meta")
            .is_some_and(|record| valid_filename(record) && !directory.join(record).is_file());
        if filename.contains(".tmp-") || filename.ends_with(".bak") || stale_sidecar {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "Could not clean render cache transaction artifact: {error}"
                    ));
                }
            }
        }
    }
    Ok(())
}

fn cache_records(directory: &Path) -> Result<Vec<CacheRecord>, String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Could not list render cache records: {error}")),
    };
    let mut records = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not inspect render cache record: {error}"))?;
        let filename = entry.file_name().to_string_lossy().to_string();
        if !valid_filename(&filename) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Could not inspect render cache metadata: {error}"))?;
        if !metadata.is_file() {
            continue;
        }
        let sidecar = access_path(&entry.path());
        let sidecar_size = fs::metadata(&sidecar).map(|value| value.len()).unwrap_or(0);
        let last_access_ms = fs::read_to_string(&sidecar)
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .or_else(|| {
                metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis() as u64)
            })
            .unwrap_or(0);
        let byte_size = metadata
            .len()
            .checked_add(sidecar_size)
            .and_then(|size| size.checked_add(METADATA_RESERVE_BYTES))
            .ok_or_else(|| "Render cache size overflow".to_string())?;
        records.push(CacheRecord {
            path: entry.path(),
            byte_size,
            last_access_ms,
        });
    }
    Ok(records)
}

fn remove_record(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Could not evict render cache record: {error}")),
    }
    match fs::remove_file(access_path(path)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not evict render cache metadata: {error}")),
    }
}

fn transactional_write(path: &Path, bytes: &[u8], max_bytes: Option<u64>) -> Result<(), String> {
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err("Render cache record exceeds the supported size".to_string());
    }
    let directory = path
        .parent()
        .ok_or_else(|| "Render cache path has no parent".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Could not create render cache directory: {error}"))?;
    cleanup_transaction_artifacts(directory)?;

    if let Some(max_bytes) = max_bytes {
        let retained_sidecar_size = match fs::metadata(access_path(path)) {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
            Err(error) => {
                return Err(format!(
                    "Could not inspect render cache replacement metadata: {error}"
                ));
            }
        };
        let incoming_size = (bytes.len() as u64)
            .checked_add(METADATA_RESERVE_BYTES)
            .and_then(|size| size.checked_add(retained_sidecar_size))
            .ok_or_else(|| "Render cache size overflow".to_string())?;
        if incoming_size > max_bytes {
            return Err("Render cache record exceeds the configured byte budget".to_string());
        }
        let mut records = cache_records(directory)?;
        records.retain(|record| record.path != path);
        records.sort_by(|left, right| {
            left.last_access_ms
                .cmp(&right.last_access_ms)
                .then_with(|| left.path.file_name().cmp(&right.path.file_name()))
        });
        let mut total = records.iter().try_fold(incoming_size, |sum, record| {
            sum.checked_add(record.byte_size)
                .ok_or_else(|| "Render cache size overflow".to_string())
        })?;
        for record in records {
            if total <= max_bytes {
                break;
            }
            remove_record(&record.path)?;
            total -= record.byte_size;
        }
    }

    atomic_write(path, bytes)
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn render_cache_read(
    app: AppHandle,
    workspace_identity: String,
    key: String,
) -> Result<Option<Vec<u8>>, String> {
    let _guard = cache_lock()?;
    let path = record_path(&app, &workspace_identity, &key)?;
    match fs::metadata(&path) {
        Ok(metadata) if metadata.len() > MAX_RECORD_BYTES => {
            let _ = fs::remove_file(&path);
            let _ = fs::remove_file(access_path(&path));
            return Ok(None);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Could not inspect render cache record: {error}")),
        _ => {}
    }
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read render cache record: {error}")),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn render_cache_write(
    app: AppHandle,
    workspace_identity: String,
    key: String,
    bytes: Vec<u8>,
    max_bytes: Option<u64>,
) -> Result<(), String> {
    let _guard = cache_lock()?;
    transactional_write(
        &record_path(&app, &workspace_identity, &key)?,
        &bytes,
        max_bytes,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn render_cache_remove(
    app: AppHandle,
    workspace_identity: String,
    key: String,
) -> Result<(), String> {
    let _guard = cache_lock()?;
    let path = record_path(&app, &workspace_identity, &key)?;
    let metadata = access_path(&path);
    match fs::remove_file(path) {
        Ok(()) => {
            let _ = fs::remove_file(metadata);
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let _ = fs::remove_file(metadata);
            Ok(())
        }
        Err(error) => Err(format!("Could not remove render cache record: {error}")),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn render_cache_clear(app: AppHandle, workspace_identity: String) -> Result<(), String> {
    let _guard = cache_lock()?;
    if workspace_identity.is_empty() {
        return Err("Invalid render cache identity".to_string());
    }
    let directory = cache_root(&app)?.join(hex_digest(&workspace_identity));
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Could not list render cache records: {error}")),
    };
    for entry in entries {
        let path = entry
            .map_err(|error| format!("Could not inspect render cache record: {error}"))?
            .path();
        if path.is_file() {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("Could not clear render cache record: {error}")),
            }
        }
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn render_cache_touch(
    app: AppHandle,
    workspace_identity: String,
    key: String,
) -> Result<(), String> {
    let _guard = cache_lock()?;
    let path = record_path(&app, &workspace_identity, &key)?;
    fs::metadata(&path)
        .map_err(|error| format!("Could not inspect render cache record for touch: {error}"))?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("Could not determine render cache access time: {error}"))?
        .as_millis()
        .to_string();
    atomic_write(&access_path(&path), millis.as_bytes())
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn render_cache_list(
    app: AppHandle,
    workspace_identity: String,
) -> Result<Vec<RenderCacheRecordWire>, String> {
    let _guard = cache_lock()?;
    if workspace_identity.is_empty() {
        return Err("Invalid render cache identity".to_string());
    }
    let directory = cache_root(&app)?.join(hex_digest(&workspace_identity));
    cleanup_transaction_artifacts(&directory)?;
    cache_records(&directory)?
        .into_iter()
        .map(|record| {
            let filename = record
                .path
                .file_name()
                .ok_or_else(|| "Render cache record has no filename".to_string())?
                .to_string_lossy();
            Ok(RenderCacheRecordWire {
                key: format!("{CACHE_KEY_PREFIX}{filename}"),
                byte_size: record.byte_size,
                last_access_ms: record.last_access_ms,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_RECORD_BYTES, METADATA_RESERVE_BYTES, access_path, atomic_write, hex_digest,
        transactional_write, valid_filename, valid_key,
    };

    #[test]
    fn workspace_identity_is_opaque_and_keys_are_canonical_hex() {
        assert_eq!(hex_digest("C:\\Projects\\A").len(), 64);
        assert!(valid_key(&format!("sha256:{}", "a".repeat(64))));
        assert!(!valid_key(&"a".repeat(64)));
        assert!(!valid_key(&"ABCDEF0123456789".repeat(4)));
        assert!(!valid_key("../escape"));
        assert!(!valid_key(&"a".repeat(63)));
        assert!(valid_filename(&"a".repeat(64)));
        assert!(!valid_filename(
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        ));
    }

    #[test]
    fn atomic_record_replacement_and_oversize_rejection_are_local_and_recoverable() {
        let root =
            std::env::temp_dir().join(format!("scadmill-render-cache-test-{}", std::process::id()));
        let path = root.join("record");
        std::fs::create_dir_all(&root).expect("create temp cache");
        atomic_write(&path, b"first").expect("write first record");
        atomic_write(&path, b"second").expect("replace record");
        assert_eq!(std::fs::read(&path).expect("read replacement"), b"second");
        assert!(atomic_write(&path, &vec![0_u8; MAX_RECORD_BYTES as usize + 1]).is_err());
        std::fs::remove_dir_all(root).expect("cleanup temp cache");
    }

    #[test]
    fn bounded_write_evicts_lru_records_and_cleans_stale_transaction_files() {
        let root = std::env::temp_dir().join(format!(
            "scadmill-render-cache-bounded-test-{}",
            std::process::id()
        ));
        let old = root.join("a".repeat(64));
        let kept = root.join("b".repeat(64));
        let incoming = root.join("c".repeat(64));
        std::fs::create_dir_all(&root).expect("create temp cache");
        atomic_write(&old, b"old!").expect("write oldest record");
        atomic_write(&access_path(&old), b"1").expect("touch oldest record");
        atomic_write(&kept, b"keep").expect("write newer record");
        atomic_write(&access_path(&kept), b"2").expect("touch newer record");
        let stale = root.join(".stale.tmp-999");
        std::fs::write(&stale, b"partial").expect("write stale transaction file");
        let stale_backup = root.join(".stale.bak");
        std::fs::write(&stale_backup, b"backup").expect("write stale backup");
        let orphan_sidecar = root.join(format!("{}.meta", "e".repeat(64)));
        std::fs::write(&orphan_sidecar, b"3").expect("write orphan sidecar");

        let budget = (b"new".len() + b"keep".len() + 1) as u64 + METADATA_RESERVE_BYTES * 2;
        transactional_write(&incoming, b"new", Some(budget)).expect("bounded write");

        assert!(!old.exists(), "oldest record should be evicted");
        assert!(
            !access_path(&old).exists(),
            "evicted metadata should be removed"
        );
        assert!(kept.exists(), "newer record should be retained");
        assert!(
            access_path(&kept).exists(),
            "live metadata should be retained"
        );
        assert_eq!(std::fs::read(&incoming).expect("read incoming"), b"new");
        assert!(!stale.exists(), "stale transaction file should be cleaned");
        assert!(!stale_backup.exists(), "stale backup should be cleaned");
        assert!(
            !orphan_sidecar.exists(),
            "orphan metadata should be cleaned"
        );
        std::fs::remove_dir_all(root).expect("cleanup temp cache");
    }

    #[test]
    fn bounded_write_rejects_an_entry_that_cannot_fit_without_replacing_the_old_value() {
        let root = std::env::temp_dir().join(format!(
            "scadmill-render-cache-budget-test-{}",
            std::process::id()
        ));
        let target = root.join("d".repeat(64));
        std::fs::create_dir_all(&root).expect("create temp cache");
        atomic_write(&target, b"old").expect("write existing record");

        assert!(transactional_write(&target, b"new", Some(METADATA_RESERVE_BYTES + 2)).is_err());
        assert_eq!(
            std::fs::read(&target).expect("read preserved record"),
            b"old"
        );
        std::fs::remove_dir_all(root).expect("cleanup temp cache");
    }
}
