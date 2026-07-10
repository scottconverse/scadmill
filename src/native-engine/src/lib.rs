use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds3D {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub size: [f32; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub struct ParsedStl {
    pub triangle_count: u32,
    pub bounds: Bounds3D,
}

#[derive(Debug, Error, PartialEq)]
pub enum StlError {
    #[error("binary STL is {actual} bytes; at least 84 bytes are required")]
    TooShort { actual: usize },
    #[error("binary STL contains no triangles")]
    Empty,
    #[error(
        "binary STL is {actual} bytes; {expected} bytes are required for {triangles} triangles"
    )]
    LengthMismatch {
        actual: usize,
        expected: usize,
        triangles: u32,
    },
    #[error("binary STL triangle {triangle} contains a non-finite coordinate")]
    NonFinite { triangle: u32 },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum RenderQuality {
    Preview,
    Full,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ParamValue {
    Number(f64),
    Boolean(bool),
    String(String),
    Vector(Vec<f64>),
}

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
        source: io::Error,
    },
    #[error("OpenSCAD render failed with exit code {exit_code:?}: {log}")]
    Process { exit_code: Option<i32>, log: String },
    #[error("OpenSCAD returned an unreadable version response: {0}")]
    InvalidVersion(String),
    #[error("invalid parameter {name}: {detail}")]
    InvalidParameter { name: String, detail: &'static str },
    #[error(transparent)]
    Stl(#[from] StlError),
}

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

pub fn find_engine(configured: Option<&Path>) -> Result<PathBuf, EngineError> {
    if let Some(engine) = configured.and_then(usable_engine) {
        return Ok(engine);
    }
    if let Some(engine) = env::var_os("SCADMILL_OPENSCAD")
        .as_deref()
        .map(Path::new)
        .and_then(usable_engine)
    {
        return Ok(engine);
    }

    let executable_names: &[&str] = if cfg!(target_os = "windows") {
        &["openscad.exe", "openscad.com"]
    } else {
        &["openscad"]
    };
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            for executable in executable_names {
                if let Some(engine) = usable_engine(&directory.join(executable)) {
                    return Ok(engine);
                }
            }
        }
    }
    Err(EngineError::Missing)
}

fn io_error(operation: &'static str) -> impl FnOnce(io::Error) -> EngineError {
    move |source| EngineError::Io { operation, source }
}

fn parameter_definitions(
    parameters: &BTreeMap<String, ParamValue>,
) -> Result<Vec<String>, EngineError> {
    parameters
        .iter()
        .map(|(name, value)| {
            if !valid_parameter_name(name) {
                return Err(EngineError::InvalidParameter {
                    name: name.clone(),
                    detail: "name must be an OpenSCAD identifier",
                });
            }
            Ok(format!("{name}={}", format_parameter_value(name, value)?))
        })
        .collect()
}

fn valid_parameter_name(name: &str) -> bool {
    let mut characters = name.chars();
    let Some(mut first) = characters.next() else {
        return false;
    };
    if first == '$' {
        let Some(special_start) = characters.next() else {
            return false;
        };
        first = special_start;
    }
    (first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn finite_number(name: &str, value: f64) -> Result<String, EngineError> {
    if value.is_finite() {
        Ok(value.to_string())
    } else {
        Err(EngineError::InvalidParameter {
            name: name.to_string(),
            detail: "numbers must be finite",
        })
    }
}

fn quoted_string(name: &str, value: &str) -> Result<String, EngineError> {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            control if control.is_control() => {
                return Err(EngineError::InvalidParameter {
                    name: name.to_string(),
                    detail: "strings contain an unsupported control character",
                });
            }
            other => output.push(other),
        }
    }
    output.push('"');
    Ok(output)
}

fn format_parameter_value(name: &str, value: &ParamValue) -> Result<String, EngineError> {
    match value {
        ParamValue::Number(number) => finite_number(name, *number),
        ParamValue::Boolean(boolean) => Ok(boolean.to_string()),
        ParamValue::String(string) => quoted_string(name, string),
        ParamValue::Vector(numbers) => {
            let values = numbers
                .iter()
                .map(|number| finite_number(name, *number))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(format!("[{}]", values.join(", ")))
        }
    }
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
    let definitions = parameter_definitions(parameters)?;
    let workspace = tempfile::tempdir().map_err(io_error("create a render workspace"))?;
    let input_path = workspace.path().join("main.scad");
    let output_path = workspace.path().join("model.stl");
    fs::write(&input_path, source).map_err(io_error("write the OpenSCAD input"))?;

    let mut command = Command::new(engine);
    command.current_dir(workspace.path());
    command.args(["--export-format", "binstl"]);
    for definition in definitions {
        command.arg("-D").arg(definition);
    }
    if quality == RenderQuality::Preview {
        command.args(["-D", "$fn=48"]);
    }
    command.arg("-o").arg("model.stl").arg("main.scad");

    let started = Instant::now();
    let output = command
        .output()
        .map_err(io_error("start the OpenSCAD engine"))?;
    let elapsed = started.elapsed().as_millis();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let raw_log = match (stdout.is_empty(), stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => stdout.into_owned(),
        (true, false) => stderr.into_owned(),
        (false, false) => format!("[stdout]\n{stdout}\n[stderr]\n{stderr}"),
    };
    if !output.status.success() {
        return Err(EngineError::Process {
            exit_code: output.status.code(),
            log: raw_log,
        });
    }

    let mesh = fs::read(output_path).map_err(io_error("read the rendered STL"))?;
    let geometry = parse_binary_stl(&mesh)?;
    Ok(NativeRenderOutput {
        mesh,
        geometry,
        raw_log,
        engine_time_ms: elapsed,
    })
}

const HEADER_BYTES: usize = 84;
const TRIANGLE_BYTES: usize = 50;
const NORMAL_BYTES: usize = 12;
const COORDINATES_PER_TRIANGLE: usize = 9;

pub fn parse_binary_stl(bytes: &[u8]) -> Result<ParsedStl, StlError> {
    if bytes.len() < HEADER_BYTES {
        return Err(StlError::TooShort {
            actual: bytes.len(),
        });
    }

    let triangle_count = u32::from_le_bytes(bytes[80..84].try_into().expect("fixed-width slice"));
    if triangle_count == 0 {
        return Err(StlError::Empty);
    }

    let expected = HEADER_BYTES + triangle_count as usize * TRIANGLE_BYTES;
    if bytes.len() != expected {
        return Err(StlError::LengthMismatch {
            actual: bytes.len(),
            expected,
            triangles: triangle_count,
        });
    }

    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for triangle in 0..triangle_count as usize {
        let vertices = HEADER_BYTES + triangle * TRIANGLE_BYTES + NORMAL_BYTES;
        for coordinate in 0..COORDINATES_PER_TRIANGLE {
            let offset = vertices + coordinate * 4;
            let value = f32::from_le_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("validated STL length"),
            );
            if !value.is_finite() {
                return Err(StlError::NonFinite {
                    triangle: triangle as u32 + 1,
                });
            }

            let axis = coordinate % 3;
            min[axis] = min[axis].min(value);
            max[axis] = max[axis].max(value);
        }
    }

    Ok(ParsedStl {
        triangle_count,
        bounds: Bounds3D {
            min,
            max,
            size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{
        ParamValue, RenderQuality, StlError, engine_version, find_engine, parameter_definitions,
        parse_binary_stl, render_scad, render_scad_with_parameters,
    };
    use std::collections::BTreeMap;

    fn one_triangle() -> Vec<u8> {
        let mut bytes = vec![0_u8; 84 + 50];
        bytes[80..84].copy_from_slice(&1_u32.to_le_bytes());
        let vertices = [[-5.0_f32, 2.0, -1.0], [5.0, 2.0, -1.0], [5.0, 22.0, 29.0]];
        for (vertex_index, vertex) in vertices.iter().enumerate() {
            for (axis, coordinate) in vertex.iter().enumerate() {
                let offset = 84 + 12 + vertex_index * 12 + axis * 4;
                bytes[offset..offset + 4].copy_from_slice(&coordinate.to_le_bytes());
            }
        }
        bytes
    }

    #[test]
    fn parses_triangle_count_and_bounds() {
        let parsed = parse_binary_stl(&one_triangle()).expect("fixture should parse");

        assert_eq!(parsed.triangle_count, 1);
        assert_eq!(parsed.bounds.min, [-5.0, 2.0, -1.0]);
        assert_eq!(parsed.bounds.max, [5.0, 22.0, 29.0]);
        assert_eq!(parsed.bounds.size, [10.0, 20.0, 30.0]);
    }

    #[test]
    fn rejects_short_and_truncated_payloads() {
        assert_eq!(
            parse_binary_stl(&[0_u8; 83]),
            Err(StlError::TooShort { actual: 83 })
        );

        let mut truncated = one_triangle();
        truncated.pop();
        assert_eq!(
            parse_binary_stl(&truncated),
            Err(StlError::LengthMismatch {
                actual: 133,
                expected: 134,
                triangles: 1,
            })
        );
    }

    #[test]
    fn rejects_non_finite_coordinates() {
        let mut bytes = one_triangle();
        bytes[96..100].copy_from_slice(&f32::NAN.to_le_bytes());

        assert_eq!(
            parse_binary_stl(&bytes),
            Err(StlError::NonFinite { triangle: 1 })
        );
    }

    #[test]
    fn renders_nonuniform_geometry_with_the_real_engine() {
        let engine = find_engine(None).expect("the pinned OpenSCAD engine should be installed");
        let rendered = render_scad(&engine, "cube([10, 20, 30]);", RenderQuality::Full)
            .expect("the engine should render a nonuniform cube");

        assert_eq!(rendered.geometry.triangle_count, 12);
        assert_eq!(rendered.geometry.bounds.size, [10.0, 20.0, 30.0]);
        assert_eq!(rendered.mesh.len(), 684);
    }

    #[test]
    fn reads_the_pinned_engine_version() {
        let engine = find_engine(None).expect("the pinned OpenSCAD engine should be installed");

        assert_eq!(
            engine_version(&engine).expect("version should be readable"),
            "2021.01"
        );
    }

    #[test]
    fn formats_typed_parameter_definitions_in_stable_order() {
        let parameters = BTreeMap::from([
            ("size".to_string(), ParamValue::Number(20.0)),
            ("centered".to_string(), ParamValue::Boolean(true)),
            (
                "label".to_string(),
                ParamValue::String("quoted \"text\" \\ path".to_string()),
            ),
            (
                "points".to_string(),
                ParamValue::Vector(vec![1.0, -2.5, 3.0]),
            ),
        ]);

        assert_eq!(
            parameter_definitions(&parameters).expect("parameters should format"),
            vec![
                "centered=true",
                "label=\"quoted \\\"text\\\" \\\\ path\"",
                "points=[1, -2.5, 3]",
                "size=20",
            ]
        );
    }

    #[test]
    fn rejects_unsafe_parameter_names_and_non_finite_numbers() {
        assert!(
            parameter_definitions(&BTreeMap::from([(
                "size; echo(1)".to_string(),
                ParamValue::Number(1.0),
            )]))
            .is_err()
        );
        assert!(
            parameter_definitions(&BTreeMap::from([(
                "size".to_string(),
                ParamValue::Number(f64::NAN),
            )]))
            .is_err()
        );
        assert!(
            parameter_definitions(&BTreeMap::from([(
                "points".to_string(),
                ParamValue::Vector(vec![1.0, f64::INFINITY]),
            )]))
            .is_err()
        );
        for name in ["$", "$1"] {
            assert!(
                parameter_definitions(&BTreeMap::from([(
                    name.to_string(),
                    ParamValue::Number(1.0),
                )]))
                .is_err(),
                "{name} is not a valid OpenSCAD identifier"
            );
        }
    }

    #[test]
    fn applies_parameter_overrides_to_real_engine_geometry() {
        let engine = find_engine(None).expect("the pinned OpenSCAD engine should be installed");
        let parameters = BTreeMap::from([("size".to_string(), ParamValue::Number(20.0))]);

        let rendered = render_scad_with_parameters(
            &engine,
            "size = 10; cube(size);",
            RenderQuality::Full,
            &parameters,
        )
        .expect("the engine should render with a parameter override");

        assert_eq!(rendered.geometry.bounds.size, [20.0, 20.0, 20.0]);
    }

    #[test]
    fn reports_a_parser_error_with_the_raw_engine_log() {
        let engine = find_engine(None).expect("the pinned OpenSCAD engine should be installed");

        let result = render_scad(&engine, "cube(10)\n", RenderQuality::Full);

        match result {
            Err(super::EngineError::Process { exit_code, log }) => {
                assert_eq!(exit_code, Some(1));
                assert!(log.contains("ERROR: Parser error"), "unexpected log: {log}");
                assert!(
                    log.contains("in file main.scad, line"),
                    "temporary workspace path leaked into the engine log: {log}"
                );
            }
            other => panic!("expected a typed process failure, got {other:?}"),
        }
    }
}
