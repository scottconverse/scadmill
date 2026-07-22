mod discovery;
mod parameters;
mod process;
mod project;
mod project_layout;
mod stl;

pub use discovery::{engine_version, find_engine, find_engine_with_bundled};
pub use parameters::ParamValue;
pub use process::{EngineOutputEvent, EngineOutputStream};
pub use project::{
    Bounds2D, CameraPose, ExportImage, NativeExportFormat, NativeGeometry, ProjectExportOutput,
    ProjectRenderOutput, RenderQuality, export_project, render_project, render_project_colored,
};
pub use stl::{Bounds3D, ParsedStl, StlError, parse_binary_stl};

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Duration;
use thiserror::Error;

#[derive(Clone, Debug, PartialEq)]
pub struct NativeRenderOutput {
    pub mesh: Vec<u8>,
    pub geometry: ParsedStl,
    pub raw_log: String,
    pub engine_time_ms: u128,
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("OpenSCAD engine was not found")]
    Missing,
    #[error("could not {operation}: {source}")]
    Io {
        operation: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error("OpenSCAD render failed with exit code {exit_code:?}: {log}")]
    Process { exit_code: Option<i32>, log: String },
    #[error("OpenSCAD operation timed out: {log}")]
    Timeout { log: String },
    #[error("OpenSCAD operation was cancelled: {log}")]
    Cancelled { log: String },
    #[error("OpenSCAD returned an unreadable version response: {0}")]
    InvalidVersion(String),
    #[error("invalid parameter {name}: {detail}")]
    InvalidParameter { name: String, detail: &'static str },
    #[error("invalid project path {path:?}: {detail}")]
    InvalidProject { path: String, detail: &'static str },
    #[error("OpenSCAD returned an unreadable geometry summary: {0}")]
    InvalidGeometrySummary(String),
    #[error("could not {operation}: {detail}")]
    Artifact {
        operation: &'static str,
        detail: String,
        log: String,
    },
    #[error(transparent)]
    Stl(#[from] StlError),
}

pub(crate) fn io_error(operation: &'static str) -> impl FnOnce(std::io::Error) -> EngineError {
    move |source| EngineError::Io { operation, source }
}

pub fn render_scad(
    engine: &Path,
    source: &str,
    quality: RenderQuality,
) -> Result<NativeRenderOutput, EngineError> {
    render_scad_with_parameters(engine, source, quality, &BTreeMap::new())
}

pub fn render_scad_with_parameters(
    engine: &Path,
    source: &str,
    quality: RenderQuality,
    parameters: &BTreeMap<String, ParamValue>,
) -> Result<NativeRenderOutput, EngineError> {
    let files = BTreeMap::from([("main.scad".to_string(), source.as_bytes().to_vec())]);
    let rendered = render_project(
        engine,
        "main.scad",
        &files,
        quality,
        parameters,
        Some(48),
        Duration::from_secs(600),
        &AtomicBool::new(false),
        &|_| {},
    )?;
    match rendered.geometry {
        NativeGeometry::ThreeD { mesh, geometry } => Ok(NativeRenderOutput {
            mesh,
            geometry,
            raw_log: rendered.raw_log,
            engine_time_ms: rendered.engine_time_ms,
        }),
        NativeGeometry::TwoD { .. } => Err(EngineError::Process {
            exit_code: Some(1),
            log: "Current top level object is not a 3D object.".to_string(),
        }),
        NativeGeometry::ThreeMf { .. } => Err(EngineError::InvalidProject {
            path: "main.scad".to_string(),
            detail: "the legacy STL helper cannot return 3MF geometry",
        }),
    }
}
