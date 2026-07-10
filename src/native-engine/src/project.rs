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

fn parse_svg_bounds(svg: &str) -> Result<Bounds2D, EngineError> {
    let start = svg
        .find("viewBox=\"")
        .map(|index| index + "viewBox=\"".len())
        .ok_or_else(|| EngineError::InvalidSvg("missing viewBox".to_string()))?;
    let end = svg[start..]
        .find('"')
        .map(|index| start + index)
        .ok_or_else(|| EngineError::InvalidSvg("unterminated viewBox".to_string()))?;
    let values = svg[start..end]
        .split_ascii_whitespace()
        .map(str::parse::<f32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| EngineError::InvalidSvg("non-numeric viewBox".to_string()))?;
    let [x, y, width, height] = values.as_slice() else {
        return Err(EngineError::InvalidSvg(
            "viewBox must contain four numbers".to_string(),
        ));
    };
    if !values.iter().all(|value| value.is_finite()) || *width < 0.0 || *height < 0.0 {
        return Err(EngineError::InvalidSvg(
            "invalid viewBox extent".to_string(),
        ));
    }
    Ok(Bounds2D {
        min: [*x, -(*y + *height)],
        max: [*x + *width, -*y],
    })
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
    let workspace = tempfile::tempdir().map_err(io_error("create a render workspace"))?;
    let project_root = workspace.path().join("project");
    let output_root = workspace.path().join("output");
    fs::create_dir_all(&project_root).map_err(io_error("create the staged project root"))?;
    fs::create_dir_all(&output_root).map_err(io_error("create the render output root"))?;
    let entry_path = stage_project(&project_root, entry_file, files)?;
    let started = Instant::now();
    let sequence = AtomicU64::new(0);

    let stl_path = output_root.join("model.stl");
    let mut stl_command = configure_command(
        engine,
        &project_root,
        &entry_path,
        stl_path.to_string_lossy().as_ref(),
        "binstl",
        quality,
        parameters,
        preview_facet_limit,
    )?;
    let stl_capture = run_command(
        &mut stl_command,
        timeout,
        cancelled,
        &sequence,
        started,
        on_output,
    )?;
    if stl_capture.success {
        let mesh = match fs::read(stl_path) {
            Ok(mesh) => mesh,
            Err(source) => {
                return Err(artifact_failure(
                    "read the rendered STL",
                    source,
                    stl_capture.raw_log,
                ));
            }
        };
        let geometry = match parse_binary_stl(&mesh) {
            Ok(geometry) => geometry,
            Err(source) => {
                return Err(artifact_failure(
                    "parse the rendered STL",
                    source,
                    stl_capture.raw_log,
                ));
            }
        };
        return Ok(ProjectRenderOutput {
            geometry: NativeGeometry::ThreeD { mesh, geometry },
            raw_log: stl_capture.raw_log,
            engine_time_ms: started.elapsed().as_millis(),
        });
    }
    if !stl_capture
        .raw_log
        .contains("Current top level object is not a 3D object.")
    {
        return Err(process_failure(stl_capture));
    }

    let svg_path = output_root.join("model.svg");
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
    let svg_capture = run_command(
        &mut svg_command,
        timeout,
        cancelled,
        &sequence,
        started,
        on_output,
    )?;
    let raw_log = format!("{}{}", stl_capture.raw_log, svg_capture.raw_log);
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
    let bounds = match parse_svg_bounds(&svg) {
        Ok(bounds) => bounds,
        Err(source) => return Err(artifact_failure("parse the rendered SVG", source, raw_log)),
    };
    Ok(ProjectRenderOutput {
        geometry: NativeGeometry::TwoD { svg, bounds },
        raw_log,
        engine_time_ms: started.elapsed().as_millis(),
    })
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
    use super::{CameraPose, ExportImage, NativeExportFormat, export_project, parse_svg_bounds};
    use crate::{EngineError, ParamValue};
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    #[test]
    fn converts_the_openscad_svg_viewbox_back_to_model_coordinates() {
        let bounds =
            parse_svg_bounds("<svg viewBox=\"2 -23 10 20\">").expect("viewBox should parse");
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
