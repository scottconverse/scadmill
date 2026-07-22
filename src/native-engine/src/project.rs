use crate::parameters::parameter_definitions;
use crate::process::run_command;
use crate::project_layout::{validate_project_layout, validate_project_path};
use crate::{EngineError, EngineOutputEvent, ParamValue, ParsedStl, io_error, parse_binary_stl};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RenderQuality {
    Preview,
    Full,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds2D {
    pub min: [f32; 2],
    pub max: [f32; 2],
}

#[derive(Clone, Debug, PartialEq)]
pub enum NativeGeometry {
    ThreeD { mesh: Vec<u8>, geometry: ParsedStl },
    ThreeMf { archive: Vec<u8> },
    TwoD { svg: String, bounds: Bounds2D },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProjectRenderOutput {
    pub geometry: NativeGeometry,
    pub raw_log: String,
    pub engine_time_ms: u128,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum NativeExportFormat {
    StlBinary,
    StlAscii,
    #[serde(rename = "3mf")]
    ThreeMf,
    Off,
    Amf,
    Svg,
    Dxf,
    Png,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct CameraPose {
    pub position: [f64; 3],
    pub target: [f64; 3],
    pub up: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    pub width: u32,
    pub height: u32,
    pub camera: Option<CameraPose>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProjectExportOutput {
    pub bytes: Vec<u8>,
    pub file_extension: &'static str,
    pub raw_log: String,
    pub engine_time_ms: u128,
}

impl NativeExportFormat {
    fn command_format(self) -> (&'static str, &'static str) {
        match self {
            Self::StlBinary => ("binstl", "stl"),
            Self::StlAscii => ("asciistl", "stl"),
            Self::ThreeMf => ("3mf", "3mf"),
            Self::Off => ("off", "off"),
            Self::Amf => ("amf", "amf"),
            Self::Svg => ("svg", "svg"),
            Self::Dxf => ("dxf", "dxf"),
            Self::Png => ("png", "png"),
        }
    }
}

fn stage_project(
    root: &Path,
    entry_file: &str,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<PathBuf, EngineError> {
    let entry_path = validate_project_path(entry_file)?;
    if !files.contains_key(entry_file) {
        return Err(EngineError::InvalidProject {
            path: entry_file.to_string(),
            detail: "the entry document is missing from the project file map",
        });
    }
    validate_project_layout(files)?;
    for (logical_path, contents) in files {
        let relative = validate_project_path(logical_path)?;
        let destination = root.join(relative);
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(io_error("create a project directory"))?;
        }
        fs::write(destination, contents).map_err(io_error("stage a project file"))?;
    }
    Ok(entry_path)
}

#[allow(clippy::too_many_arguments)]
fn configure_command(
    engine: &Path,
    project_root: &Path,
    entry_file: &Path,
    output_file: &str,
    export_format: &str,
    quality: RenderQuality,
    parameters: &BTreeMap<String, ParamValue>,
    preview_facet_limit: Option<u32>,
) -> Result<Command, EngineError> {
    let mut command = Command::new(engine);
    command.current_dir(project_root);
    command.args(["--export-format", export_format]);
    if export_format == "3mf" {
        configure_color_3mf_mode(&mut command);
    }
    for definition in parameter_definitions(parameters)? {
        command.arg("-D").arg(definition);
    }
    if quality == RenderQuality::Preview
        && let Some(limit) = preview_facet_limit
    {
        command.arg("-D").arg(format!("$fn={limit}"));
    }
    command.arg("-o").arg(output_file).arg(entry_file);
    Ok(command)
}

fn configure_color_3mf_mode(command: &mut Command) {
    command
        .args(["--backend", "Manifold"])
        .args(["--enable", "lazy-union"])
        .args(["-O", "export-3mf/color-mode=model"])
        .args(["-O", "export-3mf/material-type=color"]);
}

#[derive(Deserialize)]
struct GeometrySummary {
    geometry: SummaryGeometry,
}

#[derive(Deserialize)]
struct SummaryGeometry {
    dimensions: u8,
    bounding_box: SummaryBoundingBox,
}

#[derive(Deserialize)]
struct SummaryBoundingBox {
    min: [f32; 2],
    max: [f32; 2],
}

fn parse_geometry_summary(summary: &str) -> Result<Bounds2D, EngineError> {
    let parsed: GeometrySummary = serde_json::from_str(summary)
        .map_err(|source| EngineError::InvalidGeometrySummary(source.to_string()))?;
    if parsed.geometry.dimensions != 2 {
        return Err(EngineError::InvalidGeometrySummary(format!(
            "expected two dimensions, got {}",
            parsed.geometry.dimensions
        )));
    }
    let bounds = Bounds2D {
        min: parsed.geometry.bounding_box.min,
        max: parsed.geometry.bounding_box.max,
    };
    if !bounds
        .min
        .iter()
        .chain(bounds.max.iter())
        .all(|value| value.is_finite())
        || bounds.min[0] > bounds.max[0]
        || bounds.min[1] > bounds.max[1]
    {
        return Err(EngineError::InvalidGeometrySummary(
            "invalid bounding-box extent".to_string(),
        ));
    }
    Ok(bounds)
}

fn process_failure(capture: crate::process::ProcessCapture) -> EngineError {
    EngineError::Process {
        exit_code: capture.exit_code,
        log: capture.raw_log,
    }
}

fn artifact_failure(
    operation: &'static str,
    detail: impl std::fmt::Display,
    log: String,
) -> EngineError {
    EngineError::Artifact {
        operation,
        detail: detail.to_string(),
        log,
    }
}

#[allow(clippy::too_many_arguments)]
fn render_project_with_format(
    engine: &Path,
    entry_file: &str,
    files: &BTreeMap<String, Vec<u8>>,
    quality: RenderQuality,
    parameters: &BTreeMap<String, ParamValue>,
    preview_facet_limit: Option<u32>,
    timeout: Duration,
    cancelled: &AtomicBool,
    on_output: &dyn Fn(EngineOutputEvent),
    color_preserving: bool,
) -> Result<ProjectRenderOutput, EngineError> {
    let workspace = tempfile::tempdir().map_err(io_error("create a render workspace"))?;
    let project_root = workspace.path().join("project");
    let output_root = workspace.path().join("output");
    fs::create_dir_all(&project_root).map_err(io_error("create the staged project root"))?;
    fs::create_dir_all(&output_root).map_err(io_error("create the render output root"))?;
    let entry_path = stage_project(&project_root, entry_file, files)?;
    let started = Instant::now();
    let sequence = AtomicU64::new(0);

    let three_d_path = output_root.join(if color_preserving {
        "model.3mf"
    } else {
        "model.stl"
    });
    let mut three_d_command = configure_command(
        engine,
        &project_root,
        &entry_path,
        three_d_path.to_string_lossy().as_ref(),
        if color_preserving { "3mf" } else { "binstl" },
        quality,
        parameters,
        preview_facet_limit,
    )?;
    let three_d_capture = run_command(
        &mut three_d_command,
        timeout,
        cancelled,
        &sequence,
        started,
        on_output,
    )?;
    if three_d_capture.success {
        let mesh = match fs::read(three_d_path) {
            Ok(mesh) => mesh,
            Err(source) => {
                return Err(artifact_failure(
                    if color_preserving {
                        "read the rendered 3MF"
                    } else {
                        "read the rendered STL"
                    },
                    source,
                    three_d_capture.raw_log,
                ));
            }
        };
        if color_preserving {
            return Ok(ProjectRenderOutput {
                geometry: NativeGeometry::ThreeMf { archive: mesh },
                raw_log: three_d_capture.raw_log,
                engine_time_ms: started.elapsed().as_millis(),
            });
        }
        let geometry = match parse_binary_stl(&mesh) {
            Ok(geometry) => geometry,
            Err(source) => {
                return Err(artifact_failure(
                    "parse the rendered STL",
                    source,
                    three_d_capture.raw_log,
                ));
            }
        };
        return Ok(ProjectRenderOutput {
            geometry: NativeGeometry::ThreeD { mesh, geometry },
            raw_log: three_d_capture.raw_log,
            engine_time_ms: started.elapsed().as_millis(),
        });
    }
    if !three_d_capture
        .raw_log
        .contains("Current top level object is not a 3D object.")
    {
        return Err(process_failure(three_d_capture));
    }

    let svg_path = output_root.join("model.svg");
    let summary_path = output_root.join("model-summary.json");
    let mut svg_command = configure_command(
        engine,
        &project_root,
        &entry_path,
        svg_path.to_string_lossy().as_ref(),
        "svg",
        quality,
        parameters,
        preview_facet_limit,
    )?;
    svg_command
        .arg("--summary")
        .arg("geometry")
        .arg("--summary")
        .arg("bounding-box")
        .arg("--summary-file")
        .arg(&summary_path);
    let svg_capture = run_command(
        &mut svg_command,
        timeout,
        cancelled,
        &sequence,
        started,
        on_output,
    )?;
    let raw_log = format!("{}{}", three_d_capture.raw_log, svg_capture.raw_log);
    if !svg_capture.success {
        return Err(EngineError::Process {
            exit_code: svg_capture.exit_code,
            log: raw_log,
        });
    }
    let svg = match fs::read_to_string(svg_path) {
        Ok(svg) => svg,
        Err(source) => {
            return Err(artifact_failure("read the rendered SVG", source, raw_log));
        }
    };
    let summary = match fs::read_to_string(summary_path) {
        Ok(summary) => summary,
        Err(source) => {
            return Err(artifact_failure(
                "read the geometry summary",
                source,
                raw_log,
            ));
        }
    };
    let bounds = match parse_geometry_summary(&summary) {
        Ok(bounds) => bounds,
        Err(source) => {
            return Err(artifact_failure(
                "parse the geometry summary",
                source,
                raw_log,
            ));
        }
    };
    Ok(ProjectRenderOutput {
        geometry: NativeGeometry::TwoD { svg, bounds },
        raw_log,
        engine_time_ms: started.elapsed().as_millis(),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn render_project(
    engine: &Path,
    entry_file: &str,
    files: &BTreeMap<String, Vec<u8>>,
    quality: RenderQuality,
    parameters: &BTreeMap<String, ParamValue>,
    preview_facet_limit: Option<u32>,
    timeout: Duration,
    cancelled: &AtomicBool,
    on_output: &dyn Fn(EngineOutputEvent),
) -> Result<ProjectRenderOutput, EngineError> {
    render_project_with_format(
        engine,
        entry_file,
        files,
        quality,
        parameters,
        preview_facet_limit,
        timeout,
        cancelled,
        on_output,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn render_project_colored(
    engine: &Path,
    entry_file: &str,
    files: &BTreeMap<String, Vec<u8>>,
    quality: RenderQuality,
    parameters: &BTreeMap<String, ParamValue>,
    preview_facet_limit: Option<u32>,
    timeout: Duration,
    cancelled: &AtomicBool,
    on_output: &dyn Fn(EngineOutputEvent),
) -> Result<ProjectRenderOutput, EngineError> {
    render_project_with_format(
        engine,
        entry_file,
        files,
        quality,
        parameters,
        preview_facet_limit,
        timeout,
        cancelled,
        on_output,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn export_project(
    engine: &Path,
    entry_file: &str,
    files: &BTreeMap<String, Vec<u8>>,
    parameters: &BTreeMap<String, ParamValue>,
    format: NativeExportFormat,
    image: Option<ExportImage>,
    timeout: Duration,
    cancelled: &AtomicBool,
    on_output: &dyn Fn(EngineOutputEvent),
) -> Result<ProjectExportOutput, EngineError> {
    let workspace = tempfile::tempdir().map_err(io_error("create an export workspace"))?;
    let project_root = workspace.path().join("project");
    let output_root = workspace.path().join("output");
    fs::create_dir_all(&project_root).map_err(io_error("create the staged project root"))?;
    fs::create_dir_all(&output_root).map_err(io_error("create the export output root"))?;
    let entry_path = stage_project(&project_root, entry_file, files)?;
    let (command_format, extension) = format.command_format();
    let output_path = output_root.join(format!("model.{extension}"));
    let mut command = configure_command(
        engine,
        &project_root,
        &entry_path,
        output_path.to_string_lossy().as_ref(),
        command_format,
        RenderQuality::Full,
        parameters,
        None,
    )?;
    if format == NativeExportFormat::Png {
        command.arg("--render=true");
        if let Some(image) = image {
            if image.width == 0 || image.height == 0 {
                return Err(EngineError::InvalidProject {
                    path: entry_file.to_string(),
                    detail: "PNG width and height must be positive",
                });
            }
            command.arg(format!("--imgsize={},{}", image.width, image.height));
            if let Some(camera) = image.camera {
                if !camera
                    .position
                    .iter()
                    .chain(camera.target.iter())
                    .chain(camera.up.iter())
                    .all(|value| value.is_finite())
                {
                    return Err(EngineError::InvalidProject {
                        path: entry_file.to_string(),
                        detail: "PNG camera values must be finite",
                    });
                }
                return Err(EngineError::InvalidProject {
                    path: entry_file.to_string(),
                    detail: "explicit PNG cameras are unavailable because the pinned engine CLI cannot preserve CameraPose.up (Q-0021)",
                });
            }
        }
    }
    let started = Instant::now();
    let capture = run_command(
        &mut command,
        timeout,
        cancelled,
        &AtomicU64::new(0),
        started,
        on_output,
    )?;
    if !capture.success {
        return Err(process_failure(capture));
    }
    let bytes = match fs::read(output_path) {
        Ok(bytes) => bytes,
        Err(source) => {
            return Err(artifact_failure(
                "read the exported artifact",
                source,
                capture.raw_log,
            ));
        }
    };
    Ok(ProjectExportOutput {
        bytes,
        file_extension: extension,
        raw_log: capture.raw_log,
        engine_time_ms: started.elapsed().as_millis(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        CameraPose, ExportImage, NativeExportFormat, RenderQuality, configure_command,
        export_project, parse_geometry_summary,
    };
    use crate::{EngineError, ParamValue};
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    #[test]
    fn reads_exact_model_bounds_from_the_openscad_geometry_summary() {
        let bounds = parse_geometry_summary(
            r#"{"geometry":{"bounding_box":{"max":[12.0,23.0],"min":[2.0,3.0],"size":[10.0,20.0]},"dimensions":2}}"#,
        )
        .expect("geometry summary should parse");
        assert_eq!(bounds.min, [2.0, 3.0]);
        assert_eq!(bounds.max, [12.0, 23.0]);
    }

    #[test]
    fn maps_every_export_format_to_its_cli_token_and_extension() {
        let cases = [
            (NativeExportFormat::StlBinary, ("binstl", "stl")),
            (NativeExportFormat::StlAscii, ("asciistl", "stl")),
            (NativeExportFormat::ThreeMf, ("3mf", "3mf")),
            (NativeExportFormat::Off, ("off", "off")),
            (NativeExportFormat::Amf, ("amf", "amf")),
            (NativeExportFormat::Svg, ("svg", "svg")),
            (NativeExportFormat::Dxf, ("dxf", "dxf")),
            (NativeExportFormat::Png, ("png", "png")),
        ];

        for (format, expected) in cases {
            assert_eq!(format.command_format(), expected, "mapping for {format:?}");
        }
    }

    #[test]
    fn centralizes_the_normative_color_3mf_engine_mode_without_base_material() {
        let command = configure_command(
            Path::new("openscad"),
            Path::new("project"),
            Path::new("fixture.scad"),
            "fixture.3mf",
            "3mf",
            RenderQuality::Full,
            &BTreeMap::new(),
            None,
        )
        .expect("valid 3MF command");
        let arguments = command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["--backend", "Manifold"])
        );
        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["--enable", "lazy-union"])
        );
        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["-O", "export-3mf/color-mode=model"])
        );
        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["-O", "export-3mf/material-type=color"])
        );
        assert!(
            !arguments
                .iter()
                .any(|argument| argument.contains("basematerial"))
        );
    }

    #[test]
    fn rejects_an_explicit_png_camera_instead_of_ignoring_its_up_vector() {
        let result = export_project(
            Path::new("definitely-missing-openscad"),
            "main.scad",
            &BTreeMap::from([("main.scad".to_string(), b"cube(1);".to_vec())]),
            &BTreeMap::<String, ParamValue>::new(),
            NativeExportFormat::Png,
            Some(ExportImage {
                width: 640,
                height: 480,
                camera: Some(CameraPose {
                    position: [10.0, 10.0, 10.0],
                    target: [0.0, 0.0, 0.0],
                    up: [0.0, 0.0, 1.0],
                }),
            }),
            Duration::from_secs(1),
            &AtomicBool::new(false),
            &|_| {},
        );

        match result {
            Err(EngineError::InvalidProject { path, detail }) => {
                assert_eq!(path, "main.scad");
                assert_eq!(
                    detail,
                    "explicit PNG cameras are unavailable because the pinned engine CLI cannot preserve CameraPose.up (Q-0021)"
                );
            }
            other => panic!("expected a typed camera rejection, got {other:?}"),
        }
    }
}
