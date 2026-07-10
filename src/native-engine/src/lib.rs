use serde::Serialize;
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

pub fn render_scad(
    engine: &Path,
    source: &str,
    quality: RenderQuality,
) -> Result<NativeRenderOutput, EngineError> {
    let workspace = tempfile::tempdir().map_err(io_error("create a render workspace"))?;
    let input_path = workspace.path().join("main.scad");
    let output_path = workspace.path().join("model.stl");
    fs::write(&input_path, source).map_err(io_error("write the OpenSCAD input"))?;

    let mut command = Command::new(engine);
    command.args(["--export-format", "binstl"]);
    if quality == RenderQuality::Preview {
        command.args(["-D", "$fn=48"]);
    }
    command.arg("-o").arg(&output_path).arg(&input_path);

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
        RenderQuality, StlError, engine_version, find_engine, parse_binary_stl, render_scad,
    };

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
}
