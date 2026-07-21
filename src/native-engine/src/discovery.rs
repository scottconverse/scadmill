use crate::{EngineError, io_error};
use std::env;
#[cfg(target_os = "windows")]
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn engine_version(engine: &Path) -> Result<String, EngineError> {
    let output = Command::new(engine)
        .arg("--version")
        .output()
        .map_err(io_error("query the OpenSCAD version"))?;
    let response = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(EngineError::Process {
            exit_code: output.status.code(),
            log: response,
        });
    }

    response
        .lines()
        .find_map(|line| line.trim().strip_prefix("OpenSCAD version "))
        .filter(|version| !version.is_empty())
        .map(str::to_string)
        .ok_or(EngineError::InvalidVersion(response))
}

fn usable_engine(candidate: &Path) -> Option<PathBuf> {
    if !candidate.is_file() {
        return None;
    }

    #[cfg(target_os = "windows")]
    {
        let shim_descriptor = candidate.with_extension("shim");
        if shim_descriptor.is_file()
            && let Ok(descriptor) = fs::read_to_string(shim_descriptor)
            && let Some(quoted) = descriptor.split('"').nth(1)
        {
            let target = PathBuf::from(quoted);
            let executable = if target
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("com"))
            {
                target.with_extension("exe")
            } else {
                target
            };
            if executable.is_file() {
                return Some(executable);
            }
        }
    }

    Some(candidate.to_path_buf())
}

fn path_engine() -> Option<PathBuf> {
    let executable_names: &[&str] = if cfg!(target_os = "windows") {
        &["openscad.exe", "openscad.com"]
    } else {
        &["openscad"]
    };
    env::var_os("PATH").and_then(|path| {
        env::split_paths(&path).find_map(|directory| {
            executable_names
                .iter()
                .find_map(|executable| usable_engine(&directory.join(executable)))
        })
    })
}

pub fn find_engine_with_bundled(
    bundled: Option<&Path>,
    configured: Option<&Path>,
) -> Result<PathBuf, EngineError> {
    bundled
        .and_then(usable_engine)
        .or_else(|| configured.and_then(usable_engine))
        .or_else(|| {
            env::var_os("SCADMILL_OPENSCAD")
                .as_deref()
                .map(Path::new)
                .and_then(usable_engine)
        })
        .or_else(path_engine)
        .ok_or(EngineError::Missing)
}

pub fn find_engine(configured: Option<&Path>) -> Result<PathBuf, EngineError> {
    find_engine_with_bundled(None, configured)
}

#[cfg(test)]
mod tests {
    use super::find_engine_with_bundled;
    use std::fs;

    #[test]
    fn bundled_candidate_precedes_the_configured_candidate() {
        let root = tempfile::tempdir().expect("temporary discovery directory");
        let bundled = root.path().join("bundled-openscad");
        let configured = root.path().join("configured-openscad");
        fs::write(&bundled, []).expect("bundled candidate");
        fs::write(&configured, []).expect("configured candidate");

        assert_eq!(
            find_engine_with_bundled(Some(&bundled), Some(&configured))
                .expect("bundled candidate should win"),
            bundled
        );
    }
}
