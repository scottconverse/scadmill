use base64::Engine as _;
use scadmill_native_engine::{
    EngineError, EngineOutputEvent, ExportImage, NativeExportFormat, NativeGeometry, ParamValue,
    RenderQuality, engine_version, export_project, find_engine_with_bundled, render_project,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State, ipc::Channel};

mod ai_http_broker;
mod artifact_storage;
mod associated_files;
mod desktop_settings;
mod engine_version_manager;
mod headless_cli;
mod keychain;
mod mcp_stdio;
mod native_menu;
mod project_storage;
mod render_cache;
mod slicer_handoff;

pub use headless_cli::run_headless_cli;
pub use mcp_stdio::run_mcp_stdio_client;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeEngineVersionWire {
    version: String,
    build_identity: String,
}

fn native_engine_build_identity(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Could not read engine executable: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Could not hash engine executable: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    let bytes = digest.finalize();
    Ok(format!(
        "native:sha256:{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeProjectFile {
    path: String,
    text: bool,
    contents_base64: String,
}

fn decode_project_files(
    entry_file: &str,
    files: Vec<NativeProjectFile>,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let entry_is_text = files
        .iter()
        .any(|file| file.path == entry_file && file.text);
    if !entry_is_text {
        return Err(format!(
            "The entry document {entry_file} is missing or is not UTF-8 text."
        ));
    }
    let mut decoded = BTreeMap::new();
    for file in files {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(file.contents_base64)
            .map_err(|error| format!("Invalid base64 for {}: {error}", file.path))?;
        if file.text {
            std::str::from_utf8(&bytes)
                .map_err(|error| format!("Invalid UTF-8 for {}: {error}", file.path))?;
        }
        if decoded.insert(file.path.clone(), bytes).is_some() {
            return Err(format!("Duplicate project path: {}", file.path));
        }
    }
    Ok(decoded)
}

const PENDING_CANCEL_LIMIT: usize = 256;

#[derive(Default)]
struct NativeJobRegistry {
    active: HashMap<String, Arc<AtomicBool>>,
    pending_cancellations: VecDeque<String>,
}

#[derive(Default)]
struct NativeJobs(Mutex<NativeJobRegistry>);

impl NativeJobs {
    fn register(&self, job_id: &str) -> Result<Arc<AtomicBool>, String> {
        let mut jobs = self.0.lock().map_err(|_| "Native job registry failed")?;
        let was_cancelled = jobs
            .pending_cancellations
            .iter()
            .position(|pending| pending == job_id)
            .and_then(|index| jobs.pending_cancellations.remove(index))
            .is_some();
        let token = Arc::new(AtomicBool::new(was_cancelled));
        if let Some(previous) = jobs.active.insert(job_id.to_string(), Arc::clone(&token)) {
            previous.store(true, Ordering::Release);
        }
        Ok(token)
    }

    fn cancel(&self, job_id: &str) {
        if let Ok(mut jobs) = self.0.lock() {
            if let Some(token) = jobs.active.get(job_id) {
                token.store(true, Ordering::Release);
            } else if !jobs
                .pending_cancellations
                .iter()
                .any(|pending| pending == job_id)
            {
                jobs.pending_cancellations.push_back(job_id.to_string());
                while jobs.pending_cancellations.len() > PENDING_CANCEL_LIMIT {
                    jobs.pending_cancellations.pop_front();
                }
            }
        }
    }

    fn finish(&self, job_id: &str, token: &Arc<AtomicBool>) {
        if let Ok(mut jobs) = self.0.lock()
            && jobs
                .active
                .get(job_id)
                .is_some_and(|current| Arc::ptr_eq(current, token))
        {
            jobs.active.remove(job_id);
        }
    }
}

fn finish_after_join<T>(
    jobs: &NativeJobs,
    job_id: &str,
    token: &Arc<AtomicBool>,
    joined: Result<T, String>,
) -> Result<T, String> {
    jobs.finish(job_id, token);
    joined
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRenderSuccess3DResponse {
    kind: &'static str,
    format: &'static str,
    mesh_base64: String,
    triangle_count: u32,
    bounds: scadmill_native_engine::Bounds3D,
    volume_mm3: f64,
    raw_log: String,
    engine_time_ms: u128,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRenderSuccess2DResponse {
    kind: &'static str,
    svg: String,
    bounds: scadmill_native_engine::Bounds2D,
    raw_log: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRenderFailureResponse {
    kind: &'static str,
    reason: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    raw_log: String,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(untagged)]
enum NativeRenderResponse {
    ThreeD(NativeRenderSuccess3DResponse),
    TwoD(NativeRenderSuccess2DResponse),
    Failure(NativeRenderFailureResponse),
}

fn map_render_error(error: EngineError) -> Result<NativeRenderResponse, String> {
    let (reason, exit_code, raw_log) = match error {
        EngineError::Process { exit_code, log } => ("engine-error", exit_code, log),
        EngineError::Timeout { log } => ("timeout", None, log),
        EngineError::Cancelled { log } => ("cancelled", None, log),
        EngineError::Artifact { log, .. } => ("engine-error", None, log),
        EngineError::Missing => (
            "engine-missing",
            None,
            "OpenSCAD engine was not found".to_string(),
        ),
        other => ("engine-error", None, other.to_string()),
    };
    Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
        kind: "failure",
        reason,
        exit_code,
        raw_log,
    }))
}

fn bundled_engine_candidate(app: &AppHandle) -> Option<PathBuf> {
    let root = app.path().resource_dir().ok()?.join("engine");
    let name = if cfg!(target_os = "windows") {
        "openscad.exe"
    } else {
        "openscad"
    };
    Some(root.join(name))
}

fn find_native_engine(
    app: &AppHandle,
    configured_engine_path: Option<&str>,
    required_engine_version: Option<&str>,
) -> Result<PathBuf, EngineError> {
    let bundled = bundled_engine_candidate(app);
    let configured = configured_engine_path.map(Path::new);
    let required = required_engine_version
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let managed = required.and_then(|version| {
        let safe = version.len() <= 64
            && version.chars().enumerate().all(|(index, character)| {
                character.is_ascii_alphanumeric()
                    || (index > 0 && matches!(character, '.' | '_' | '+' | '-'))
            });
        if !safe {
            return None;
        }
        let executable = if cfg!(target_os = "windows") {
            "openscad.exe"
        } else {
            "openscad"
        };
        app.path()
            .app_data_dir()
            .ok()
            .map(|root| root.join("engines").join(version).join(executable))
    });
    let engine = managed
        .filter(|path| path.is_file())
        .map(Ok)
        .unwrap_or_else(|| find_engine_with_bundled(bundled.as_deref(), configured))?;
    if let Some(required) = required {
        let found = engine_version(&engine)?;
        if found != required {
            return Err(EngineError::InvalidVersion(format!(
                "OpenSCAD version {found} is available, but this project requires {required}."
            )));
        }
    }
    Ok(engine)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
async fn render_native(
    app: AppHandle,
    jobs: State<'_, NativeJobs>,
    job_id: String,
    entry_file: String,
    files: Vec<NativeProjectFile>,
    quality: String,
    parameters: BTreeMap<String, ParamValue>,
    preview_facet_limit: Option<u32>,
    timeout_ms: u64,
    on_output: Channel<EngineOutputEvent>,
    configured_engine_path: Option<String>,
    required_engine_version: Option<String>,
) -> Result<NativeRenderResponse, String> {
    let files = decode_project_files(&entry_file, files)?;
    let quality = match quality.as_str() {
        "preview" => RenderQuality::Preview,
        "full" => RenderQuality::Full,
        other => return Err(format!("Unsupported render quality: {other}")),
    };
    let engine = match find_native_engine(
        &app,
        configured_engine_path.as_deref(),
        required_engine_version.as_deref(),
    ) {
        Ok(engine) => engine,
        Err(error) => return map_render_error(error),
    };
    let token = jobs.register(&job_id)?;
    let worker_token = Arc::clone(&token);
    let joined = tauri::async_runtime::spawn_blocking(move || {
        render_project(
            &engine,
            &entry_file,
            &files,
            quality,
            &parameters,
            preview_facet_limit,
            Duration::from_millis(timeout_ms),
            &worker_token,
            &|event| {
                let _ = on_output.send(event);
            },
        )
        .map(|rendered| match rendered.geometry {
            NativeGeometry::ThreeD { mesh, geometry } => {
                NativeRenderResponse::ThreeD(NativeRenderSuccess3DResponse {
                    kind: "3d",
                    format: "stl-binary",
                    mesh_base64: base64::engine::general_purpose::STANDARD.encode(mesh),
                    triangle_count: geometry.triangle_count,
                    bounds: geometry.bounds,
                    volume_mm3: geometry.volume_mm3,
                    raw_log: rendered.raw_log,
                    engine_time_ms: rendered.engine_time_ms,
                })
            }
            NativeGeometry::TwoD { svg, bounds } => {
                NativeRenderResponse::TwoD(NativeRenderSuccess2DResponse {
                    kind: "2d",
                    svg,
                    bounds,
                    raw_log: rendered.raw_log,
                })
            }
        })
        .or_else(map_render_error)
    })
    .await
    .map_err(|error| format!("Native render task failed: {error}"));
    finish_after_join(&jobs, &job_id, &token, joined)?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeExportResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    artifact_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_extension: Option<String>,
    raw_log: String,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
async fn export_native(
    app: AppHandle,
    jobs: State<'_, NativeJobs>,
    job_id: String,
    entry_file: String,
    files: Vec<NativeProjectFile>,
    parameters: BTreeMap<String, ParamValue>,
    format: NativeExportFormat,
    image: Option<ExportImage>,
    timeout_ms: u64,
    on_output: Channel<EngineOutputEvent>,
    configured_engine_path: Option<String>,
    required_engine_version: Option<String>,
) -> Result<NativeExportResponse, String> {
    let files = decode_project_files(&entry_file, files)?;
    let engine = match find_native_engine(
        &app,
        configured_engine_path.as_deref(),
        required_engine_version.as_deref(),
    ) {
        Ok(engine) => engine,
        Err(error) => {
            return Ok(NativeExportResponse {
                ok: false,
                artifact_base64: None,
                file_extension: None,
                raw_log: error.to_string(),
            });
        }
    };
    let token = jobs.register(&job_id)?;
    let worker_token = Arc::clone(&token);
    let joined = tauri::async_runtime::spawn_blocking(move || {
        match export_project(
            &engine,
            &entry_file,
            &files,
            &parameters,
            format,
            image,
            Duration::from_millis(timeout_ms),
            &worker_token,
            &|event| {
                let _ = on_output.send(event);
            },
        ) {
            Ok(exported) => NativeExportResponse {
                ok: true,
                artifact_base64: Some(
                    base64::engine::general_purpose::STANDARD.encode(exported.bytes),
                ),
                file_extension: Some(exported.file_extension.to_string()),
                raw_log: exported.raw_log,
            },
            Err(error) => NativeExportResponse {
                ok: false,
                artifact_base64: None,
                file_extension: None,
                raw_log: match error {
                    EngineError::Process { log, .. }
                    | EngineError::Timeout { log }
                    | EngineError::Cancelled { log }
                    | EngineError::Artifact { log, .. } => log,
                    other => other.to_string(),
                },
            },
        }
    })
    .await
    .map_err(|error| format!("Native export task failed: {error}"));
    let result = finish_after_join(&jobs, &job_id, &token, joined)?;
    Ok(result)
}

#[tauri::command(rename_all = "camelCase")]
fn cancel_native(jobs: State<'_, NativeJobs>, job_id: String) {
    jobs.cancel(&job_id);
}

#[tauri::command(rename_all = "camelCase")]
async fn native_engine_version(
    app: AppHandle,
    configured_engine_path: Option<String>,
    required_engine_version: Option<String>,
) -> Result<Option<NativeEngineVersionWire>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = match find_native_engine(
            &app,
            configured_engine_path.as_deref(),
            required_engine_version.as_deref(),
        ) {
            Ok(engine) => engine,
            Err(EngineError::Missing) => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let version = engine_version(&engine).map_err(|error| error.to_string())?;
        let build_identity = native_engine_build_identity(&engine)?;
        Ok(Some(NativeEngineVersionWire {
            version,
            build_identity,
        }))
    })
    .await
    .map_err(|error| format!("Engine version task failed: {error}"))?
}

#[cfg(test)]
mod tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, working_directory| {
                let pending = app.state::<associated_files::AssociatedFileQueue>();
                let queued = pending.enqueue_arguments(
                    arguments.into_iter().skip(1).map(Into::into),
                    Path::new(&working_directory),
                );
                associated_files::focus_main_window(app);
                if queued > 0 {
                    associated_files::wake_frontend(app);
                }
            },
        ))
        .menu(native_menu::build)
        .on_menu_event(native_menu::handle_event)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(associated_files::AssociatedFileQueue::default())
        .manage(NativeJobs::default())
        .manage(ai_http_broker::create_broker().expect("AI HTTP transport failed"))
        .manage(mcp_stdio::McpStdioBridge::default())
        .setup(|app| {
            let current_directory = std::env::current_dir().unwrap_or_default();
            app.state::<associated_files::AssociatedFileQueue>()
                .enqueue_arguments(std::env::args_os().skip(1), &current_directory);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            render_native,
            export_native,
            cancel_native,
            native_engine_version,
            ai_http_broker::ai_http_request,
            ai_http_broker::cancel_ai_http_request,
            desktop_settings::load_settings,
            desktop_settings::save_settings,
            engine_version_manager::engine_manager_list,
            engine_version_manager::engine_manager_official_releases,
            engine_version_manager::engine_manager_install_official,
            keychain::load_ai_secret,
            keychain::save_ai_secret,
            keychain::clear_ai_secret,
            mcp_stdio::mcp_set_enabled,
            mcp_stdio::mcp_write_response,
            project_storage::project_snapshot,
            project_storage::project_read,
            project_storage::project_write,
            project_storage::project_move,
            project_storage::project_trash,
            project_storage::project_reveal,
            render_cache::render_cache_read,
            render_cache::render_cache_write,
            render_cache::render_cache_remove,
            render_cache::render_cache_clear,
            render_cache::render_cache_touch,
            render_cache::render_cache_list,
            artifact_storage::save_artifact,
            slicer_handoff::open_in_slicer,
            associated_files::take_pending_associated_files,
            native_menu::update_native_menu_state,
            native_menu::disable_native_menu,
        ])
        .build(tauri::generate_context!())
        .expect("ScadMill desktop runtime failed");
    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let pending = app.state::<associated_files::AssociatedFileQueue>();
            if pending.enqueue_macos_urls(urls) > 0 {
                associated_files::focus_main_window(app);
                associated_files::wake_frontend(app);
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
