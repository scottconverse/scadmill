use serde::Serialize;
use std::collections::VecDeque;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub(crate) const ASSOCIATED_FILE_WAKE_EVENT: &str = "scadmill://associated-files-ready";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssociatedFileOpenRequest {
    project_id: String,
    display_name: String,
    entry_file: String,
}

#[derive(Default)]
pub(crate) struct AssociatedFileQueue(Mutex<VecDeque<AssociatedFileOpenRequest>>);

fn project_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn request_for_file(path: &Path) -> Option<AssociatedFileOpenRequest> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("scad"))
    {
        return None;
    }
    let canonical = path.canonicalize().ok()?;
    if !canonical.is_file() {
        return None;
    }
    let parent = canonical.parent()?;
    Some(AssociatedFileOpenRequest {
        project_id: parent.to_str()?.to_string(),
        display_name: project_display_name(parent),
        entry_file: canonical.file_name()?.to_str()?.to_string(),
    })
}

impl AssociatedFileQueue {
    fn enqueue_paths<I>(&self, paths: I, base: &Path) -> usize
    where
        I: IntoIterator<Item = OsString>,
    {
        let requests = paths
            .into_iter()
            .filter_map(|candidate| {
                let path = PathBuf::from(candidate);
                request_for_file(&if path.is_absolute() {
                    path
                } else {
                    base.join(path)
                })
            })
            .collect::<Vec<_>>();
        if requests.is_empty() {
            return 0;
        }
        if let Ok(mut pending) = self.0.lock() {
            let mut added = 0;
            for request in requests {
                if pending.contains(&request) {
                    continue;
                }
                pending.push_back(request);
                added += 1;
            }
            added
        } else {
            0
        }
    }

    pub(crate) fn enqueue_arguments<I>(&self, arguments: I, working_directory: &Path) -> usize
    where
        I: IntoIterator<Item = OsString>,
    {
        self.enqueue_paths(arguments, working_directory)
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn enqueue_macos_urls(&self, urls: Vec<tauri::Url>) -> usize {
        self.enqueue_paths(
            urls.into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(PathBuf::into_os_string),
            Path::new("/"),
        )
    }

    fn take_all(&self) -> Result<Vec<AssociatedFileOpenRequest>, String> {
        let mut pending = self
            .0
            .lock()
            .map_err(|_| "Associated-file queue failed".to_string())?;
        Ok(pending.drain(..).collect())
    }
}

pub(crate) fn wake_frontend(app: &AppHandle) {
    let _ = app.emit(ASSOCIATED_FILE_WAKE_EVENT, ());
}

pub(crate) fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub(crate) fn take_pending_associated_files(
    pending: State<'_, AssociatedFileQueue>,
) -> Result<Vec<AssociatedFileOpenRequest>, String> {
    pending.take_all()
}

#[cfg(test)]
mod tests {
    use super::{AssociatedFileQueue, project_display_name};
    use std::ffi::OsString;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn filters_non_scad_arguments_and_preserves_exact_fifo_entries() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "scadmill-associated-files-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create fixture");
        fs::write(root.join("First.scad"), "cube(1);").expect("write first");
        fs::write(root.join("second.SCAD"), "sphere(2);").expect("write second");
        fs::write(root.join("notes.txt"), "ignore").expect("write ignored");
        let queue = AssociatedFileQueue::default();

        assert_eq!(
            queue.enqueue_arguments(
                [
                    "First.scad",
                    "notes.txt",
                    "First.scad",
                    "missing.scad",
                    "second.SCAD"
                ]
                .map(OsString::from),
                &root,
            ),
            2
        );
        let requests = queue.take_all().expect("drain queue");
        assert_eq!(
            requests
                .iter()
                .map(|request| request.entry_file.as_str())
                .collect::<Vec<_>>(),
            ["First.scad", "second.SCAD"]
        );
        assert!(queue.take_all().expect("second drain").is_empty());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn filesystem_root_still_has_a_project_display_name() {
        let root = std::path::Path::new(std::path::MAIN_SEPARATOR_STR);
        assert_eq!(project_display_name(root), root.to_string_lossy());
    }
}
