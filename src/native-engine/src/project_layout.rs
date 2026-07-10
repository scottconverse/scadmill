use crate::EngineError;
use std::collections::BTreeMap;
use std::path::PathBuf;

#[cfg(windows)]
fn reserved_win32_device_name(component: &str) -> bool {
    let stem = component
        .split_once('.')
        .map_or(component, |(stem, _)| stem)
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    for prefix in ["COM", "LPT"] {
        if stem.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        }) {
            return true;
        }
    }
    false
}

#[cfg(windows)]
fn validate_win32_components(path: &str) -> Result<(), EngineError> {
    for component in path.split('/') {
        let detail = if component.contains(':') {
            Some("path components must not contain alternate-data-stream separators on Windows")
        } else if component.ends_with(['.', ' ']) {
            Some("path components must not end in a dot or space on Windows")
        } else if reserved_win32_device_name(component) {
            Some("path components must not use reserved Windows device names")
        } else {
            None
        };
        if let Some(detail) = detail {
            return Err(EngineError::InvalidProject {
                path: path.to_string(),
                detail,
            });
        }
    }
    Ok(())
}

pub(crate) fn validate_project_path(path: &str) -> Result<PathBuf, EngineError> {
    let invalid = path.is_empty()
        || path.starts_with(['/', '\\'])
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || path
            .split('/')
            .next()
            .is_some_and(|part| part.contains(':'));
    if invalid {
        return Err(EngineError::InvalidProject {
            path: path.to_string(),
            detail: "paths must be normalized project-relative paths",
        });
    }
    #[cfg(windows)]
    validate_win32_components(path)?;
    Ok(path.split('/').collect())
}

#[cfg(windows)]
fn collision_key(path: &str) -> String {
    path.split('/')
        .map(|component| component.trim_end_matches(&['.', ' '][..]).to_lowercase())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(not(windows))]
fn collision_key(path: &str) -> String {
    path.to_string()
}

pub(crate) fn validate_project_layout(
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), EngineError> {
    let mut files_by_key = BTreeMap::new();
    for logical_path in files.keys() {
        validate_project_path(logical_path)?;
        if files_by_key
            .insert(collision_key(logical_path), logical_path.as_str())
            .is_some()
        {
            return Err(EngineError::InvalidProject {
                path: logical_path.to_string(),
                detail: "project file paths collide on this platform",
            });
        }
    }

    for logical_path in files.keys() {
        let components = logical_path.split('/').collect::<Vec<_>>();
        let mut parent = String::new();
        for component in &components[..components.len() - 1] {
            if !parent.is_empty() {
                parent.push('/');
            }
            parent.push_str(component);
            if let Some(file_path) = files_by_key.get(&collision_key(&parent)) {
                return Err(EngineError::InvalidProject {
                    path: (*file_path).to_string(),
                    detail: "a project file path is also a parent directory",
                });
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_project_layout;
    use crate::EngineError;
    use std::collections::BTreeMap;

    fn project_with(logical_path: &str) -> BTreeMap<String, Vec<u8>> {
        BTreeMap::from([
            ("main.scad".to_string(), b"cube(1);".to_vec()),
            (logical_path.to_string(), b"asset".to_vec()),
        ])
    }

    #[cfg(windows)]
    fn assert_windows_path_rejected(logical_path: &str) {
        let result = validate_project_layout(&project_with(logical_path));

        assert!(
            matches!(
                result,
                Err(EngineError::InvalidProject { ref path, .. }) if path == logical_path
            ),
            "unsafe Windows path was accepted: {logical_path}: {result:?}",
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_win32_alternate_data_streams_in_nested_components() {
        assert_windows_path_rejected("assets/model.scad:metadata");
    }

    #[cfg(windows)]
    #[test]
    fn rejects_win32_trailing_dot_and_space_alias_components() {
        for logical_path in [
            "parts./body.scad",
            "parts /body.scad",
            "parts/body.scad.",
            "parts/body.scad ",
        ] {
            assert_windows_path_rejected(logical_path);
        }
    }

    #[cfg(windows)]
    #[test]
    fn rejects_reserved_win32_device_names_even_with_extensions() {
        for logical_path in [
            "NUL.scad",
            "parts/con",
            "parts/CoM1.profile",
            "parts/LPT9.txt",
            "parts/COM¹.log",
            "parts/CONIN$.txt",
        ] {
            assert_windows_path_rejected(logical_path);
        }
    }

    #[test]
    fn preserves_portable_components_with_internal_spaces_dots_and_dashes() {
        let files = BTreeMap::from([
            ("main.scad".to_string(), b"cube(1);".to_vec()),
            (
                "part sets/v1.2/body-model_01.scad".to_string(),
                b"module body() {}".to_vec(),
            ),
            (
                "assets/reference mesh.stl".to_string(),
                b"solid reference\nendsolid reference\n".to_vec(),
            ),
            ("parts/COM10.scad".to_string(), b"cube(10);".to_vec()),
            ("parts/NUL-model.scad".to_string(), b"cube(2);".to_vec()),
            ("parts/auxiliary.scad".to_string(), b"cube(3);".to_vec()),
            ("parts/.hidden.scad".to_string(), b"cube(4);".to_vec()),
        ]);

        assert!(validate_project_layout(&files).is_ok());
    }
}
