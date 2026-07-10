use base64::Engine as _;
use scadmill_native_engine::{
    EngineError, ParamValue, RenderQuality, engine_version, find_engine,
    render_scad_with_parameters,
};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeRenderSuccessResponse {
    kind: &'static str,
    format: &'static str,
    mesh_base64: String,
    triangle_count: u32,
    bounds: scadmill_native_engine::Bounds3D,
    raw_log: String,
    engine_time_ms: u128,
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
    Success(NativeRenderSuccessResponse),
    Failure(NativeRenderFailureResponse),
}

fn map_render_error(error: EngineError) -> Result<NativeRenderResponse, String> {
    match error {
        EngineError::Process { exit_code, log } => {
            Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
                kind: "failure",
                reason: "engine-error",
                exit_code,
                raw_log: log,
            }))
        }
        EngineError::Missing => Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
            kind: "failure",
            reason: "engine-missing",
            exit_code: None,
            raw_log: "OpenSCAD engine was not found".to_string(),
        })),
        other => Err(other.to_string()),
    }
}

#[tauri::command]
async fn render_native(
    source: String,
    quality: String,
    parameters: BTreeMap<String, ParamValue>,
) -> Result<NativeRenderResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let engine = match find_engine(None) {
            Ok(engine) => engine,
            Err(error) => return map_render_error(error),
        };
        let quality = match quality.as_str() {
            "preview" => RenderQuality::Preview,
            "full" => RenderQuality::Full,
            other => return Err(format!("Unsupported render quality: {other}")),
        };
        match render_scad_with_parameters(&engine, &source, quality, &parameters) {
            Ok(rendered) => Ok(NativeRenderResponse::Success(NativeRenderSuccessResponse {
                kind: "3d",
                format: "stl-binary",
                mesh_base64: base64::engine::general_purpose::STANDARD.encode(rendered.mesh),
                triangle_count: rendered.geometry.triangle_count,
                bounds: rendered.geometry.bounds,
                raw_log: rendered.raw_log,
                engine_time_ms: rendered.engine_time_ms,
            })),
            Err(error) => map_render_error(error),
        }
    })
    .await
    .map_err(|error| format!("Native render task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{NativeRenderFailureResponse, NativeRenderResponse, map_render_error};
    use scadmill_native_engine::EngineError;

    #[test]
    fn maps_an_engine_process_error_to_the_typed_failure_wire_shape() {
        let mapped = map_render_error(EngineError::Process {
            exit_code: Some(1),
            log: "ERROR: Parser error in file main.scad, line 2".to_string(),
        });

        assert_eq!(
            mapped,
            Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
                kind: "failure",
                reason: "engine-error",
                exit_code: Some(1),
                raw_log: "ERROR: Parser error in file main.scad, line 2".to_string(),
            }))
        );
    }

    #[test]
    fn maps_a_missing_engine_to_the_normative_failure_reason() {
        assert_eq!(
            map_render_error(EngineError::Missing),
            Ok(NativeRenderResponse::Failure(NativeRenderFailureResponse {
                kind: "failure",
                reason: "engine-missing",
                exit_code: None,
                raw_log: "OpenSCAD engine was not found".to_string(),
            }))
        );
    }
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
