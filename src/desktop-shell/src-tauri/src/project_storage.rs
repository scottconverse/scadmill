use base64::Engine as _;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const FILE_SIZE_LIMIT: u64 = 100 * 1024 * 1024;
const PROJECT_SIZE_LIMIT: u64 = 512 * 1024 * 1024;
const PROJECT_FILE_LIMIT: usize = 20_000;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectFileWire {
    path: String,
    text: bool,
    contents_base64: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectSnapshotWire {
    project_id: String,
    workspace_identity_material: String,
    files: Vec<ProjectFileWire>,
}

fn project_root(project_id: &Path) -> Result<PathBuf, String> {
    if project_id.as_os_str().is_empty() {
        return Err("Project id must be a non-empty folder path.".to_string());
    }
    let root = fs::canonicalize(project_id)
        .map_err(|error| format!("Could not open the project folder: {error}"))?;
    if !root.is_dir() {
        return Err("The selected project root is not a folder.".to_string());
    }
    Ok(root)
}

fn reserved_windows_name(component: &str) -> bool {
    let stem = component
        .split('.')
        .next()
        .unwrap_or(component)
        .to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "AUX" | "CLOCK$" | "CON" | "CONIN$" | "CONOUT$" | "NUL" | "PRN"
    ) || ((stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem[3..]
            .parse::<u8>()
            .is_ok_and(|number| (1..=9).contains(&number)))
}

fn project_relative(path: &str) -> Result<PathBuf, String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains('\\')
        || path.contains('\0')
    {
        return Err("File path must be a normalized project-relative path.".to_string());
    }
    let mut relative = PathBuf::new();
    for component in path.split('/') {
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.contains(':')
            || component.ends_with('.')
            || component.ends_with(' ')
            || reserved_windows_name(component)
        {
            return Err("File path must be a safe project-relative path.".to_string());
        }
        relative.push(component);
    }
    Ok(relative)
}

fn checked_existing_file(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = project_relative(path)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Could not inspect project file {path}: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("Project file {path} crosses a symbolic link."));
        }
    }
    if !current.is_file() {
        return Err(format!("Project file {path} is not a regular file."));
    }
    Ok(current)
}

fn read_existing_file(root: &Path, path: &str) -> Result<Option<PathBuf>, String> {
    let relative = project_relative(path)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("Could not inspect project file {path}: {error}")),
        };
        if metadata.file_type().is_symlink() {
            return Err(format!("Project file {path} crosses a symbolic link."));
        }
    }
    if !current.is_file() {
        return Err(format!("Project file {path} is not a regular file."));
    }
    Ok(Some(current))
}

fn checked_destination(root: &Path, path: &str) -> Result<PathBuf, String> {
    let relative = project_relative(path)?;
    let file_name = relative
        .file_name()
        .ok_or_else(|| "Project destination has no file name.".to_string())?;
    let mut parent = root.to_path_buf();
    if let Some(relative_parent) = relative.parent() {
        for component in relative_parent.components() {
            parent.push(component);
            match fs::symlink_metadata(&parent) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(format!(
                        "Project destination {path} crosses a symbolic link."
                    ));
                }
                Ok(metadata) if !metadata.is_dir() => {
                    return Err(format!(
                        "Project destination parent for {path} is not a folder."
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    fs::create_dir(&parent)
                        .map_err(|error| format!("Could not create project folder: {error}"))?;
                }
                Err(error) => return Err(format!("Could not inspect project folder: {error}")),
            }
        }
    }
    let destination = parent.join(file_name);
    if let Ok(metadata) = fs::symlink_metadata(&destination)
        && (metadata.file_type().is_symlink() || metadata.is_dir())
    {
        return Err(format!("Project destination {path} is not a regular file."));
    }
    Ok(destination)
}

fn portable_project_path(relative: &Path) -> Result<String, String> {
    relative
        .components()
        .map(|component| {
            component.as_os_str().to_str().ok_or_else(|| {
                "Project entry path contains a file or folder name that is not valid Unicode."
                    .to_string()
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map(|components| components.join("/"))
}

fn collect_project_files(
    root: &Path,
    directory: &Path,
    total_size: &mut u64,
    files: &mut Vec<ProjectFileWire>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read project folder: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not enumerate project folder: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Project file escaped the selected root.".to_string())?;
        let portable = portable_project_path(relative)?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not inspect project entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Project entry {} is a symbolic link.",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_project_files(root, &path, total_size, files)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(format!(
                "Project entry {} is not a regular file.",
                path.display()
            ));
        }
        if metadata.len() > FILE_SIZE_LIMIT {
            return Err(format!("Project file {} is too large.", path.display()));
        }
        *total_size = total_size
            .checked_add(metadata.len())
            .ok_or_else(|| "Project size overflowed.".to_string())?;
        if *total_size > PROJECT_SIZE_LIMIT || files.len() >= PROJECT_FILE_LIMIT {
            return Err("Project exceeds the supported snapshot size.".to_string());
        }
        let bytes = fs::read(&path)
            .map_err(|error| format!("Could not read project file {}: {error}", path.display()))?;
        files.push(project_file_wire(portable, &path, bytes));
    }
    Ok(())
}

fn project_file_wire(portable: String, path: &Path, bytes: Vec<u8>) -> ProjectFileWire {
    let binary_asset = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "stl" | "dxf" | "png" | "ttf" | "otf" | "woff" | "woff2"
            )
        });
    let text = !binary_asset && !bytes.contains(&0) && std::str::from_utf8(&bytes).is_ok();
    ProjectFileWire {
        path: portable,
        text,
        contents_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }
}

fn read_project_file(root: &Path, path: &str) -> Result<Option<ProjectFileWire>, String> {
    let root = project_root(root)?;
    let Some(file) = read_existing_file(&root, path)? else {
        return Ok(None);
    };
    let metadata = fs::metadata(&file)
        .map_err(|error| format!("Could not inspect project file {path}: {error}"))?;
    if metadata.len() > FILE_SIZE_LIMIT {
        return Err(format!("Project file {path} is too large."));
    }
    let bytes =
        fs::read(&file).map_err(|error| format!("Could not read project file {path}: {error}"))?;
    Ok(Some(project_file_wire(path.to_string(), &file, bytes)))
}

fn unicode_project_id(root: &Path) -> Result<String, String> {
    Ok(root
        .to_str()
        .ok_or_else(|| "Canonical project folder path is not valid Unicode.".to_string())?
        .to_owned())
}

fn snapshot_project(root: &Path) -> Result<ProjectSnapshotWire, String> {
    let root = project_root(root)?;
    let project_id = unicode_project_id(&root)?;
    let mut total_size = 0;
    let mut files = Vec::new();
    collect_project_files(&root, &root, &mut total_size, &mut files)?;
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(ProjectSnapshotWire {
        workspace_identity_material: project_id.clone(),
        project_id,
        files,
    })
}

fn skip_open_scad_trivia(source: &[u8], mut index: usize) -> usize {
    loop {
        while source.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if source.get(index..index + 2) == Some(b"//") {
            index += 2;
            while source.get(index).is_some_and(|byte| *byte != b'\n') {
                index += 1;
            }
            continue;
        }
        if source.get(index..index + 2) == Some(b"/*") {
            index += 2;
            while index + 1 < source.len() && &source[index..index + 2] != b"*/" {
                index += 1;
            }
            index = (index + 2).min(source.len());
            continue;
        }
        return index;
    }
}

fn open_scad_string_literal(source: &str, start: usize) -> Option<(Option<String>, usize)> {
    let bytes = source.as_bytes();
    if bytes.get(start) != Some(&b'"') {
        return None;
    }
    let mut index = start + 1;
    let mut escaped = false;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' => {
                escaped = true;
                index = (index + 2).min(bytes.len());
            }
            b'"' => {
                let value = if escaped {
                    None
                } else {
                    Some(source[start + 1..index].to_string())
                };
                return Some((value, index + 1));
            }
            _ => index += 1,
        }
    }
    Some((None, bytes.len()))
}

fn open_scad_call_reference(
    source: &str,
    identifier_end: usize,
    named_parameter: &str,
    positional: bool,
) -> Option<String> {
    let bytes = source.as_bytes();
    let open = skip_open_scad_trivia(bytes, identifier_end);
    if bytes.get(open) != Some(&b'(') {
        return None;
    }
    let first_argument = skip_open_scad_trivia(bytes, open + 1);
    if positional
        && let Some((Some(reference), _)) = open_scad_string_literal(source, first_argument)
    {
        return Some(reference);
    }

    let mut depth = 1_u32;
    let mut index = open + 1;
    while index < bytes.len() && depth > 0 {
        let next = skip_open_scad_trivia(bytes, index);
        if next != index {
            index = next;
            continue;
        }
        match bytes[index] {
            b'"' => {
                let (_, end) = open_scad_string_literal(source, index)?;
                index = end;
            }
            b'(' => {
                depth += 1;
                index += 1;
            }
            b')' => {
                depth -= 1;
                index += 1;
            }
            byte if depth == 1 && (byte.is_ascii_alphabetic() || byte == b'_') => {
                let parameter_start = index;
                index += 1;
                while bytes
                    .get(index)
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
                {
                    index += 1;
                }
                if &source[parameter_start..index] != named_parameter {
                    continue;
                }
                let equals = skip_open_scad_trivia(bytes, index);
                if bytes.get(equals) != Some(&b'=') {
                    continue;
                }
                let value_start = skip_open_scad_trivia(bytes, equals + 1);
                if let Some((Some(reference), _)) = open_scad_string_literal(source, value_start) {
                    return Some(reference);
                }
                index = value_start;
            }
            _ => index += 1,
        }
    }
    None
}

fn local_font_reference(reference: &str) -> bool {
    Path::new(reference)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "ttf" | "otf" | "woff" | "woff2"
            )
        })
}

fn open_scad_references(source: &str) -> Vec<String> {
    let bytes = source.as_bytes();
    let mut references = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let next = skip_open_scad_trivia(bytes, index);
        if next != index {
            index = next;
            continue;
        }
        if bytes[index] == b'"' {
            index += 1;
            while index < bytes.len() {
                if bytes[index] == b'\\' {
                    index = (index + 2).min(bytes.len());
                } else if bytes[index] == b'"' {
                    index += 1;
                    break;
                } else {
                    index += 1;
                }
            }
            continue;
        }
        if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
            let identifier_start = index;
            index += 1;
            while bytes
                .get(index)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
            {
                index += 1;
            }
            let identifier = &source[identifier_start..index];
            if identifier == "import" {
                if let Some(reference) = open_scad_call_reference(source, index, "file", true) {
                    references.push(reference);
                }
                continue;
            }
            if identifier == "surface" {
                if let Some(reference) = open_scad_call_reference(source, index, "file", true) {
                    references.push(reference);
                }
                continue;
            }
            if matches!(identifier, "text" | "textmetrics" | "fontmetrics") {
                if let Some(reference) = open_scad_call_reference(source, index, "font", false)
                    && local_font_reference(&reference)
                {
                    references.push(reference);
                }
                continue;
            }
            if identifier != "include" && identifier != "use" {
                continue;
            }
            let path_start = skip_open_scad_trivia(bytes, index);
            if bytes.get(path_start) != Some(&b'<') {
                continue;
            }
            let mut path_end = path_start + 1;
            while bytes
                .get(path_end)
                .is_some_and(|byte| *byte != b'>' && *byte != b'\r' && *byte != b'\n')
            {
                path_end += 1;
            }
            if bytes.get(path_end) == Some(&b'>') && path_end > path_start + 1 {
                references.push(source[path_start + 1..path_end].to_string());
                index = path_end + 1;
            }
            continue;
        }
        index += 1;
    }
    references
}

fn resolve_open_scad_reference(declaring_path: &str, reference: &str) -> Option<String> {
    if reference.is_empty()
        || reference.starts_with('/')
        || reference.starts_with('\\')
        || reference.contains('\\')
        || reference.contains('\0')
    {
        return None;
    }
    let mut resolved = declaring_path.split('/').collect::<Vec<_>>();
    resolved.pop();
    for component in reference.split('/') {
        match component {
            "" => return None,
            "." => {}
            ".." => {
                resolved.pop()?;
            }
            value => resolved.push(value),
        }
    }
    let path = resolved.join("/");
    project_relative(&path).ok()?;
    Some(path)
}

fn is_open_scad_source_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("scad"))
}

fn snapshot_project_entry(root: &Path, entry_file: &str) -> Result<ProjectSnapshotWire, String> {
    let root = project_root(root)?;
    let entry_file = portable_project_path(&project_relative(entry_file)?)?;
    let project_id = unicode_project_id(&root)?;
    let mut pending = VecDeque::from([entry_file.clone()]);
    let mut discovered = HashMap::from([(entry_file.to_lowercase(), entry_file.clone())]);
    let mut total_size = 0_u64;
    let mut files = Vec::new();

    while let Some(path) = pending.pop_front() {
        let Some(file) = read_existing_file(&root, &path)? else {
            if path == entry_file {
                return Err(format!("Project entry file {path} does not exist."));
            }
            continue;
        };
        let metadata = fs::metadata(&file)
            .map_err(|error| format!("Could not inspect project file {path}: {error}"))?;
        if metadata.len() > FILE_SIZE_LIMIT {
            return Err(format!("Project file {path} is too large."));
        }
        total_size = total_size
            .checked_add(metadata.len())
            .ok_or_else(|| "Project size overflowed.".to_string())?;
        if total_size > PROJECT_SIZE_LIMIT || files.len() >= PROJECT_FILE_LIMIT {
            return Err(
                "Project dependency closure exceeds the supported snapshot size.".to_string(),
            );
        }
        let bytes = fs::read(&file)
            .map_err(|error| format!("Could not read project file {}: {error}", file.display()))?;
        if is_open_scad_source_path(&path)
            && let Ok(source) = std::str::from_utf8(&bytes)
        {
            for reference in open_scad_references(source) {
                if let Some(resolved) = resolve_open_scad_reference(&path, &reference) {
                    let key = resolved.to_lowercase();
                    if let Some(existing) = discovered.get(&key) {
                        if existing != &resolved {
                            return Err(format!(
                                "Project dependency paths collide case-insensitively: {existing} and {resolved}."
                            ));
                        }
                        continue;
                    }
                    if discovered.len() >= PROJECT_FILE_LIMIT {
                        return Err(
                            "Project dependency closure exceeds the supported file count."
                                .to_string(),
                        );
                    }
                    discovered.insert(key, resolved.clone());
                    pending.push_back(resolved);
                }
            }
        }
        files.push(project_file_wire(path, &file, bytes));
    }

    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(ProjectSnapshotWire {
        workspace_identity_material: project_id.clone(),
        project_id,
        files,
    })
}

#[cfg(target_os = "windows")]
fn atomic_install(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }

    let existing = temporary
        .as_os_str()
        .encode_wide()
        .chain([0])
        .collect::<Vec<_>>();
    let replacement = destination
        .as_os_str()
        .encode_wide()
        .chain([0])
        .collect::<Vec<_>>();
    // SAFETY: both UTF-16 paths are NUL-terminated and remain alive for the call. The flags
    // request an atomic replacement and durable metadata flush from the operating system.
    let installed = unsafe { MoveFileExW(existing.as_ptr(), replacement.as_ptr(), 0x0000_0009) };
    if installed != 0 {
        Ok(())
    } else {
        Err(format!(
            "Could not atomically install project file: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn atomic_install(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination)
        .map_err(|error| format!("Could not atomically install project file: {error}"))
}

fn write_project_file_with_installer(
    root: &Path,
    path: &str,
    contents: &[u8],
    install: impl FnOnce(&Path, &Path) -> Result<(), String>,
) -> Result<(), String> {
    if contents.len() as u64 > FILE_SIZE_LIMIT {
        return Err("Project file exceeds the supported size.".to_string());
    }
    let root = project_root(root)?;
    let destination = checked_destination(&root, path)?;
    let parent = destination
        .parent()
        .ok_or_else(|| "Project destination has no parent folder.".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock failed: {error}"))?
        .as_nanos();
    let temporary = parent.join(format!(
        ".scadmill-write-{}-{nonce}.tmp",
        std::process::id()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("Could not create temporary project file: {error}"))?;
    if let Err(error) = file.write_all(contents).and_then(|()| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not write project file: {error}"));
    }
    drop(file);
    if let Err(error) = install(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

pub(crate) fn write_project_file(root: &Path, path: &str, contents: &[u8]) -> Result<(), String> {
    write_project_file_with_installer(root, path, contents, atomic_install)
}

fn move_project_file(root: &Path, from: &str, to: &str) -> Result<(), String> {
    let root = project_root(root)?;
    let source = checked_existing_file(&root, from)?;
    let destination = checked_destination(&root, to)?;
    if destination.exists() {
        return Err(format!("Project destination {to} already exists."));
    }
    fs::rename(source, destination).map_err(|error| format!("Could not move project file: {error}"))
}

fn trash_project_file_with(
    root: &Path,
    path: &str,
    trash: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let root = project_root(root)?;
    trash(&checked_existing_file(&root, path)?)
}

#[cfg(target_os = "windows")]
fn move_to_os_trash(path: &Path) -> Result<(), String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct FileOperation {
        window: *mut c_void,
        function: u32,
        from: *const u16,
        to: *const u16,
        flags: u16,
        aborted: i32,
        mappings: *mut c_void,
        progress_title: *const u16,
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHFileOperationW(operation: *mut FileOperation) -> i32;
    }

    let from = path
        .as_os_str()
        .encode_wide()
        .chain([0, 0])
        .collect::<Vec<_>>();
    let mut operation = FileOperation {
        window: std::ptr::null_mut(),
        function: 3,
        from: from.as_ptr(),
        to: std::ptr::null(),
        flags: 0x0454,
        aborted: 0,
        mappings: std::ptr::null_mut(),
        progress_title: std::ptr::null(),
    };
    // SAFETY: `operation` has the documented SHFILEOPSTRUCTW layout and the source is a
    // double-NUL-terminated absolute UTF-16 path kept alive for the duration of the call.
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result == 0 && operation.aborted == 0 {
        Ok(())
    } else {
        Err(format!(
            "Could not move the project file to the Recycle Bin (code {result})."
        ))
    }
}

#[cfg(target_os = "macos")]
fn move_to_os_trash(path: &Path) -> Result<(), String> {
    let status = Command::new("osascript")
        .args([
            "-e",
            "on run argv",
            "-e",
            "tell application \"Finder\" to delete POSIX file (item 1 of argv)",
            "-e",
            "end run",
            "--",
        ])
        .arg(path)
        .status()
        .map_err(|error| format!("Could not start the macOS trash service: {error}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| "The macOS trash service rejected the project file.".to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn move_to_os_trash(path: &Path) -> Result<(), String> {
    let status = Command::new("gio")
        .arg("trash")
        .arg("--")
        .arg(path)
        .status()
        .map_err(|error| format!("Could not start the desktop trash service: {error}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| "The desktop trash service rejected the project file.".to_string())
}

fn reveal_project_file(root: &Path, path: &str) -> Result<(), String> {
    let root = project_root(root)?;
    let file = checked_existing_file(&root, path)?;
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        command.arg("/select,").arg(&file);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg("-R").arg(&file);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(file.parent().unwrap_or(&root));
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not reveal the project file: {error}"))
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn project_snapshot(
    project_id: String,
    entry_file: Option<String>,
) -> Result<ProjectSnapshotWire, String> {
    tauri::async_runtime::spawn_blocking(move || match entry_file {
        Some(entry_file) => snapshot_project_entry(Path::new(&project_id), &entry_file),
        None => snapshot_project(Path::new(&project_id)),
    })
    .await
    .map_err(|error| format!("Project snapshot task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn project_read(
    project_id: String,
    path: String,
) -> Result<Option<ProjectFileWire>, String> {
    tauri::async_runtime::spawn_blocking(move || read_project_file(Path::new(&project_id), &path))
        .await
        .map_err(|error| format!("Project read task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn project_write(
    project_id: String,
    path: String,
    text: bool,
    contents_base64: String,
) -> Result<(), String> {
    let contents = base64::engine::general_purpose::STANDARD
        .decode(contents_base64)
        .map_err(|error| format!("Project file payload is not valid base64: {error}"))?;
    if text {
        std::str::from_utf8(&contents)
            .map_err(|error| format!("Project text file is not valid UTF-8: {error}"))?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        write_project_file(Path::new(&project_id), &path, &contents)
    })
    .await
    .map_err(|error| format!("Project write task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn project_move(
    project_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_project_file(Path::new(&project_id), &from, &to)
    })
    .await
    .map_err(|error| format!("Project move task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn project_trash(project_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        trash_project_file_with(Path::new(&project_id), &path, move_to_os_trash)
    })
    .await
    .map_err(|error| format!("Project trash task failed: {error}"))?
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) async fn project_reveal(project_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reveal_project_file(Path::new(&project_id), &path))
        .await
        .map_err(|error| format!("Project reveal task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        FILE_SIZE_LIMIT, move_project_file, portable_project_path, read_project_file,
        snapshot_project, snapshot_project_entry, trash_project_file_with, unicode_project_id,
        write_project_file, write_project_file_with_installer,
    };
    use base64::Engine as _;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_project() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("scadmill-project-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&root).expect("create temp project");
        root
    }

    #[test]
    fn creates_renames_moves_and_trashes_a_file_inside_the_project() {
        let root = temp_project();

        write_project_file(&root, "parts/wheel.scad", b"cylinder(5);").expect("create file");
        assert_eq!(
            fs::read_to_string(root.join("parts/wheel.scad")).expect("created contents"),
            "cylinder(5);"
        );

        move_project_file(&root, "parts/wheel.scad", "parts/rim.scad").expect("rename file");
        assert!(!root.join("parts/wheel.scad").exists());
        assert!(root.join("parts/rim.scad").exists());

        move_project_file(&root, "parts/rim.scad", "assemblies/rim.scad").expect("move file");
        assert!(!root.join("parts/rim.scad").exists());
        assert!(root.join("assemblies/rim.scad").exists());

        trash_project_file_with(&root, "assemblies/rim.scad", |path| {
            fs::remove_file(path).map_err(|error| error.to_string())
        })
        .expect("trash file");
        assert!(!root.join("assemblies/rim.scad").exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn snapshots_text_and_binary_files_without_coercion() {
        let root = temp_project();
        write_project_file(&root, "main.scad", b"cube(10);").expect("write text");
        write_project_file(&root, "assets/reference.stl", &[0, 255, 1]).expect("write bytes");

        let files = snapshot_project(&root).expect("snapshot").files;

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "assets/reference.stl");
        assert!(!files[0].text);
        assert_eq!(files[0].contents_base64, "AP8B");
        assert_eq!(files[1].path, "main.scad");
        assert!(files[1].text);
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(&files[1].contents_base64)
                .expect("decode text"),
            b"cube(10);"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn entry_snapshot_follows_include_and_use_without_ingesting_unrelated_content() {
        let root = temp_project();
        write_project_file(
            &root,
            "gear.scad",
            b"// include <unrelated/notes.txt>\nlabel = \"use <unrelated/notes.txt>\";\ninclude <lib/assembly.scad>\ngear();",
        )
        .expect("write entry");
        write_project_file(
            &root,
            "lib/assembly.scad",
            b"use <../parts/wheel.scad>\nmodule gear() { wheel(); }",
        )
        .expect("write include");
        write_project_file(
            &root,
            "parts/wheel.scad",
            b"module wheel() { cylinder(4); }",
        )
        .expect("write use");

        let unrelated = root.join("unrelated-large.bin");
        let unrelated_file = fs::File::create(&unrelated).expect("create unrelated sparse file");
        unrelated_file
            .set_len(FILE_SIZE_LIMIT + 1)
            .expect("size unrelated sparse file");
        write_project_file(&root, "unrelated/notes.txt", b"not project input")
            .expect("write unrelated note");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&unrelated, root.join("unrelated-link"))
            .expect("create unrelated symlink");

        let snapshot = snapshot_project_entry(&root, "gear.scad").expect("targeted snapshot");
        let paths = snapshot
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            paths,
            ["gear.scad", "lib/assembly.scad", "parts/wheel.scad"]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn entry_snapshot_follows_literal_local_assets_and_preserves_binary_bytes() {
        let root = temp_project();
        write_project_file(
            &root,
            "models/main.scad",
            br#"include <../lib/labels.scad>
import("../assets/reference.stl");
import(file = "../assets/profile.dxf", convexity = 4);
surface(file = "../assets/heightmap.png", center = true);
labels();"#,
        )
        .expect("write entry");
        write_project_file(
            &root,
            "lib/labels.scad",
            br#"module labels() { text("A", font = "../fonts/workshop.ttf"); }"#,
        )
        .expect("write included source");
        write_project_file(&root, "assets/reference.stl", &[0, 255, 1, 254]).expect("write STL");
        write_project_file(&root, "assets/profile.dxf", &[68, 88, 70, 0, 255]).expect("write DXF");
        write_project_file(&root, "assets/heightmap.png", &[137, 80, 78, 71, 0, 255])
            .expect("write PNG");
        write_project_file(&root, "fonts/workshop.ttf", &[0, 1, 0, 0, 255, 17])
            .expect("write font");

        let snapshot =
            snapshot_project_entry(&root, "models/main.scad").expect("targeted snapshot");
        let paths = snapshot
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            paths,
            [
                "assets/heightmap.png",
                "assets/profile.dxf",
                "assets/reference.stl",
                "fonts/workshop.ttf",
                "lib/labels.scad",
                "models/main.scad",
            ]
        );
        let font = snapshot
            .files
            .iter()
            .find(|file| file.path == "fonts/workshop.ttf")
            .expect("font asset");
        assert!(!font.text);
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(&font.contents_base64)
                .expect("decode font"),
            [0, 1, 0, 0, 255, 17]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn entry_snapshot_follows_literal_assets_only_when_safely_inferable() {
        let root = temp_project();
        write_project_file(
            &root,
            "main.scad",
            br#"asset = "assets/dynamic.stl";
font_name = "fonts/dynamic.ttf";
import(asset);
text("A", font = font_name);
text("B", font = "Liberation Sans:style=Bold");
label = "surface(file=\"assets/string.png\")";
// import("assets/comment.stl");
/* surface(file="assets/comment.png"); */
import("assets/decoy.dxf");
cube(1);"#,
        )
        .expect("write entry");
        for path in [
            "assets/dynamic.stl",
            "fonts/dynamic.ttf",
            "assets/string.png",
            "assets/comment.stl",
            "assets/comment.png",
        ] {
            write_project_file(&root, path, &[0, 255]).expect("write decoy asset");
        }
        write_project_file(
            &root,
            "assets/decoy.dxf",
            b"include <nested.scad>\nimport(\"nested.stl\");\n0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF",
        )
        .expect("write ASCII DXF with decoy syntax");
        write_project_file(&root, "assets/nested.scad", b"sphere(99);")
            .expect("write nested SCAD decoy");
        write_project_file(&root, "assets/nested.stl", b"solid decoy\nendsolid decoy")
            .expect("write nested STL decoy");

        let snapshot = snapshot_project_entry(&root, "main.scad").expect("targeted snapshot");
        let paths = snapshot
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, ["assets/decoy.dxf", "main.scad"]);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn entry_snapshot_rejects_case_colliding_dependency_paths() {
        let root = temp_project();
        write_project_file(
            &root,
            "main.scad",
            b"include <lib/part.scad>\ninclude <LIB/PART.scad>\npart();",
        )
        .expect("write entry");
        write_project_file(&root, "lib/part.scad", b"module part() { cube(1); }")
            .expect("write dependency");

        assert_eq!(
            snapshot_project_entry(&root, "main.scad").expect_err("collision must fail"),
            "Project dependency paths collide case-insensitively: lib/part.scad and LIB/PART.scad."
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn converts_valid_child_components_to_portable_paths() {
        let relative = PathBuf::from("parts").join("模型").join("wheel.scad");

        assert_eq!(
            portable_project_path(&relative),
            Ok("parts/模型/wheel.scad".to_string())
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn rejects_non_unicode_child_components_without_lossy_substitution() {
        #[cfg(unix)]
        let unsupported_component = {
            use std::ffi::OsString;
            use std::os::unix::ffi::OsStringExt;
            OsString::from_vec(vec![0xff])
        };
        #[cfg(windows)]
        let unsupported_component = {
            use std::ffi::OsString;
            use std::os::windows::ffi::OsStringExt;
            OsString::from_wide(&[0xd800])
        };
        let relative = PathBuf::from("parts")
            .join(unsupported_component)
            .join("wheel.scad");

        assert_eq!(
            portable_project_path(&relative),
            Err(
                "Project entry path contains a file or folder name that is not valid Unicode."
                    .to_string()
            )
        );
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_rejects_a_non_unicode_child_without_returning_partial_files() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let root = temp_project();
        write_project_file(&root, "main.scad", b"cube(10);").expect("write valid child");
        let unsupported = root.join(OsString::from_vec(vec![
            b'x', 0xff, b'.', b's', b'c', b'a', b'd',
        ]));
        fs::write(unsupported, b"sphere(5);").expect("write non-Unicode child");

        let snapshot = snapshot_project(&root);
        fs::remove_dir_all(root).expect("cleanup");

        assert_eq!(
            snapshot,
            Err(
                "Project entry path contains a file or folder name that is not valid Unicode."
                    .to_string()
            )
        );
    }

    #[test]
    fn snapshot_binds_canonical_project_identity_and_files_from_one_root() {
        let root = temp_project();
        let child = root.join("child");
        fs::create_dir(&child).expect("create child");
        let alias = child.join("..");

        let expected = fs::canonicalize(&root)
            .expect("canonical root")
            .into_os_string()
            .into_string()
            .expect("unicode root");

        let snapshot = serde_json::to_value(snapshot_project(&alias).expect("snapshot"))
            .expect("serialize snapshot");

        assert_eq!(snapshot["projectId"], expected);
        assert_eq!(snapshot["workspaceIdentityMaterial"], expected);
        assert_eq!(snapshot["files"].as_array().map(Vec::len), Some(0));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn rejects_non_unicode_project_identity_without_lossy_substitution() {
        #[cfg(unix)]
        let path = {
            use std::ffi::OsString;
            use std::os::unix::ffi::OsStringExt;
            PathBuf::from(OsString::from_vec(vec![0xff]))
        };
        #[cfg(windows)]
        let path = {
            use std::ffi::OsString;
            use std::os::windows::ffi::OsStringExt;
            PathBuf::from(OsString::from_wide(&[0xd800]))
        };

        assert_eq!(
            unicode_project_id(&path).expect_err("non-Unicode path must be rejected"),
            "Canonical project folder path is not valid Unicode."
        );
    }

    #[test]
    fn reads_only_the_requested_file_and_reports_missing_or_binary_content() {
        let root = temp_project();
        write_project_file(&root, "main.scad", b"cube(10);").expect("write text");
        write_project_file(&root, "assets/reference.stl", &[0; 1024]).expect("write asset");

        let text = read_project_file(&root, "main.scad")
            .expect("read text")
            .expect("present text");
        assert_eq!(text.path, "main.scad");
        assert!(text.text);
        assert_eq!(text.contents_base64, "Y3ViZSgxMCk7");

        fs::remove_file(root.join("main.scad")).expect("delete text");
        assert_eq!(
            read_project_file(&root, "main.scad").expect("read missing"),
            None
        );

        write_project_file(&root, "main.scad", &[0, 255, 1]).expect("write binary replacement");
        let binary = read_project_file(&root, "main.scad")
            .expect("read binary")
            .expect("present binary");
        assert!(!binary.text);
        assert_eq!(binary.contents_base64, "AP8B");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn classifies_utf8_engine_assets_as_bytes_by_extension() {
        let root = temp_project();
        write_project_file(&root, "notes.txt", b"ordinary text").expect("write notes");
        write_project_file(&root, "assets/shape.stl", b"solid ascii\nendsolid ascii\n")
            .expect("write STL");
        write_project_file(&root, "assets/profile.dxf", b"0\nSECTION\n2\nENTITIES\n")
            .expect("write DXF");

        let files = snapshot_project(&root).expect("snapshot").files;

        assert!(
            files
                .iter()
                .find(|file| file.path == "notes.txt")
                .unwrap()
                .text
        );
        assert!(
            !files
                .iter()
                .find(|file| file.path == "assets/shape.stl")
                .unwrap()
                .text
        );
        assert!(
            !files
                .iter()
                .find(|file| file.path == "assets/profile.dxf")
                .unwrap()
                .text
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn failed_atomic_install_preserves_the_previous_file() {
        let root = temp_project();
        write_project_file(&root, "main.scad", b"cube(1);").expect("write original");

        let error = write_project_file_with_installer(
            &root,
            "main.scad",
            b"cube(2);",
            |_temporary, _destination| Err("simulated install failure".to_string()),
        )
        .expect_err("install must fail");

        assert_eq!(error, "simulated install failure");
        assert_eq!(
            fs::read(root.join("main.scad")).expect("original"),
            b"cube(1);"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_escape_paths_before_touching_outside_files() {
        let root = temp_project();
        let outside = root.parent().expect("parent").join("escaped.scad");
        let _ = fs::remove_file(&outside);

        let error =
            write_project_file(&root, "../escaped.scad", b"bad").expect_err("escape must fail");

        assert!(error.contains("project-relative"));
        assert!(!outside.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
