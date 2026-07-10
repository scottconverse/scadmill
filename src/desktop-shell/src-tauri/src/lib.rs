use base64::Engine as _;
use scadmill_native_engine::{RenderQuality, engine_version, find_engine, render_scad};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRenderResponse {
    kind: &'static str,
    format: &'static str,
    mesh_base64: String,
    triangle_count: u32,
    bounds: scadmill_native_engine::Bounds3D,
    raw_log: String,
    engine_time_ms: u128,
}

#[tauri::command]
async fn render_native(source: String, quality: String) -> Result<NativeRenderResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = find_engine(None).map_err(|error| error.to_string())?;
        let quality = match quality.as_str() {
            "preview" => RenderQuality::Preview,
            "full" => RenderQuality::Full,
            other => return Err(format!("Unsupported render quality: {other}")),
        };
        let rendered = render_scad(&engine, &source, quality).map_err(|error| error.to_string())?;
        Ok(NativeRenderResponse {
            kind: "3d",
            format: "stl-binary",
            mesh_base64: base64::engine::general_purpose::STANDARD.encode(rendered.mesh),
            triangle_count: rendered.geometry.triangle_count,
            bounds: rendered.geometry.bounds,
            raw_log: rendered.raw_log,
            engine_time_ms: rendered.engine_time_ms,
        })
    })
    .await
    .map_err(|error| format!("Native render task failed: {error}"))?
}

#[tauri::command]
async fn native_engine_version() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = find_engine(None).map_err(|error| error.to_string())?;
        engine_version(&engine).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Engine version task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            render_native,
            native_engine_version
        ])
        .run(tauri::generate_context!())
        .expect("ScadMill desktop runtime failed");
}
