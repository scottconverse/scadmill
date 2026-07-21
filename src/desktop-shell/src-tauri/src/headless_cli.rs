use scadmill_native_engine::{
    NativeExportFormat, NativeGeometry, ParamValue, RenderQuality, engine_version, export_project,
    find_engine, render_project,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

const PINNED_VERSION: &str = "2026.06.12";
const MAX_PROJECT_FILES: usize = 4096;
const MAX_PROJECT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_SCHEMA_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FEATURE_VERTICES: usize = 100_000;

#[derive(Clone, Copy, Debug, PartialEq)]
enum CommandKind {
    Render,
    Export,
    Params,
    Check,
    Help,
    Version,
}

#[derive(Debug, PartialEq)]
struct CliArguments {
    command: CommandKind,
    input: PathBuf,
    output: Option<PathBuf>,
    parameter_set: Option<String>,
    parameter_file: Option<PathBuf>,
    format: Option<String>,
    build_volume: [f64; 3],
    nozzle: f64,
}

#[derive(Debug)]
struct CliError {
    message: String,
    usage: bool,
}

impl CliError {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            usage: true,
        }
    }
    fn operation(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            usage: false,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParameterSchemaItem {
    name: String,
    #[serde(rename = "type")]
    value_type: &'static str,
    default: ParamValue,
}

fn command_kind(value: &str) -> Option<CommandKind> {
    match value {
        "render" => Some(CommandKind::Render),
        "export" => Some(CommandKind::Export),
        "params" => Some(CommandKind::Params),
        "check" => Some(CommandKind::Check),
        "--help" | "-h" | "help" => Some(CommandKind::Help),
        "--version" | "-V" | "version" => Some(CommandKind::Version),
        _ => None,
    }
}

fn parse_dimensions(value: &str) -> Result<[f64; 3], CliError> {
    let parts = value
        .split(['x', 'X', ','])
        .map(str::trim)
        .collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err(CliError::usage("--build-volume expects XxYxZ millimetres"));
    }
    let mut dimensions = [0.0; 3];
    for (index, part) in parts.into_iter().enumerate() {
        dimensions[index] = part
            .parse::<f64>()
            .map_err(|_| CliError::usage("invalid build-volume dimension"))?;
        if !dimensions[index].is_finite()
            || dimensions[index] <= 0.0
            || dimensions[index] > 100_000.0
        {
            return Err(CliError::usage(
                "build-volume dimensions must be finite and positive",
            ));
        }
    }
    Ok(dimensions)
}

fn required_text(value: OsString, option: &str) -> Result<String, CliError> {
    value
        .into_string()
        .map_err(|_| CliError::usage(format!("{option} must be valid Unicode")))
}

fn parse_arguments<I, S>(arguments: I) -> Result<CliArguments, CliError>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    let mut values = arguments.into_iter().map(Into::into);
    let first = values
        .next()
        .ok_or_else(|| CliError::usage("missing command"))?;
    let command_text = required_text(first, "command")?;
    let command = command_kind(&command_text)
        .ok_or_else(|| CliError::usage(format!("unknown command: {command_text}")))?;
    if matches!(command, CommandKind::Help | CommandKind::Version) {
        if values.next().is_some() {
            return Err(CliError::usage("help and version accept no arguments"));
        }
        return Ok(CliArguments {
            command,
            input: PathBuf::new(),
            output: None,
            parameter_set: None,
            parameter_file: None,
            format: None,
            build_volume: [220.0, 220.0, 250.0],
            nozzle: 0.4,
        });
    }
    let mut input = None;
    let mut output = None;
    let mut parameter_set = None;
    let mut parameter_file = None;
    let mut format = None;
    let mut build_volume = [220.0, 220.0, 250.0];
    let mut nozzle = 0.4;
    let mut pending = values.peekable();
    while let Some(value) = pending.next() {
        let option = value.to_string_lossy();
        match option.as_ref() {
            "-o" | "--output" => {
                output = Some(PathBuf::from(
                    pending
                        .next()
                        .ok_or_else(|| CliError::usage("-o requires a path"))?,
                ))
            }
            "--set" => {
                parameter_set = Some(required_text(
                    pending
                        .next()
                        .ok_or_else(|| CliError::usage("--set requires a name"))?,
                    "--set",
                )?)
            }
            "--param-file" => {
                parameter_file =
                    Some(PathBuf::from(pending.next().ok_or_else(|| {
                        CliError::usage("--param-file requires a path")
                    })?))
            }
            "--format" => {
                format = Some(
                    required_text(
                        pending
                            .next()
                            .ok_or_else(|| CliError::usage("--format requires a value"))?,
                        "--format",
                    )?
                    .to_ascii_lowercase(),
                )
            }
            "--build-volume" => {
                build_volume = parse_dimensions(&required_text(
                    pending
                        .next()
                        .ok_or_else(|| CliError::usage("--build-volume requires XxYxZ"))?,
                    "--build-volume",
                )?)?
            }
            "--nozzle" => {
                nozzle = required_text(
                    pending
                        .next()
                        .ok_or_else(|| CliError::usage("--nozzle requires millimetres"))?,
                    "--nozzle",
                )?
                .parse::<f64>()
                .map_err(|_| CliError::usage("invalid nozzle diameter"))?;
                if !nozzle.is_finite() || nozzle <= 0.0 || nozzle > 100.0 {
                    return Err(CliError::usage(
                        "nozzle diameter must be finite and positive",
                    ));
                }
            }
            _ if option.starts_with('-') => {
                return Err(CliError::usage(format!("unknown option: {option}")));
            }
            _ if input.is_none() => input = Some(PathBuf::from(value)),
            _ => return Err(CliError::usage("only one input file is accepted")),
        }
    }
    let input = input.ok_or_else(|| CliError::usage("missing input .scad file"))?;
    if !input
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("scad"))
    {
        return Err(CliError::usage("input must be a .scad file"));
    }
    if command == CommandKind::Export && output.is_none() {
        return Err(CliError::usage("export requires -o <file-or-directory>"));
    }
    Ok(CliArguments {
        command,
        input,
        output,
        parameter_set,
        parameter_file,
        format,
        build_volume,
        nozzle,
    })
}

fn valid_parameter_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(mut first) = chars.next() else {
        return false;
    };
    if first == '$' {
        let Some(next) = chars.next() else {
            return false;
        };
        first = next;
    }
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

fn literal(value: &str) -> Option<ParamValue> {
    let value = value.trim();
    if value == "true" {
        return Some(ParamValue::Boolean(true));
    }
    if value == "false" {
        return Some(ParamValue::Boolean(false));
    }
    if value.starts_with('"') && value.ends_with('"') {
        return serde_json::from_str::<String>(value)
            .ok()
            .map(ParamValue::String);
    }
    if value.starts_with('[') && value.ends_with(']') {
        let body = value[1..value.len() - 1].trim();
        if body.is_empty() {
            return None;
        }
        let numbers = body
            .split(',')
            .map(|part| part.trim().parse::<f64>())
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        if numbers.iter().all(|number| number.is_finite()) {
            return Some(ParamValue::Vector(numbers));
        }
        return None;
    }
    value
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
        .map(ParamValue::Number)
}

fn top_level_statements(source: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let (mut braces, mut brackets, mut parentheses) = (0_u32, 0_u32, 0_u32);
    let (mut string, mut line_comment, mut block_comment, mut escaped) =
        (false, false, false, false);
    let mut characters = source.chars().peekable();
    while let Some(character) = characters.next() {
        let next = characters.peek().copied();
        if line_comment {
            if character == '\n' {
                line_comment = false;
                current.push('\n');
            } else {
                current.push(' ');
            }
            continue;
        }
        if block_comment {
            if character == '*' && next == Some('/') {
                current.push_str("  ");
                characters.next();
                block_comment = false;
            } else {
                current.push(if character == '\n' { '\n' } else { ' ' });
            }
            continue;
        }
        if string {
            current.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                string = false;
            }
            continue;
        }
        if character == '/' && next == Some('/') {
            current.push_str("  ");
            characters.next();
            line_comment = true;
            continue;
        }
        if character == '/' && next == Some('*') {
            current.push_str("  ");
            characters.next();
            block_comment = true;
            continue;
        }
        if character == '"' {
            string = true;
            current.push(character);
            continue;
        }
        match character {
            '{' => braces += 1,
            '}' => {
                braces = braces.saturating_sub(1);
                if braces == 0 {
                    current.clear();
                }
            }
            '[' => brackets += 1,
            ']' => brackets = brackets.saturating_sub(1),
            '(' => parentheses += 1,
            ')' => parentheses = parentheses.saturating_sub(1),
            '>' if braces == 0 && brackets == 0 && parentheses == 0 => {
                let statement = current.trim_start();
                if statement.starts_with("include <") || statement.starts_with("use <") {
                    current.push(character);
                    statements.push(current.trim().to_string());
                    current.clear();
                    continue;
                }
            }
            ';' if braces == 0 && brackets == 0 && parentheses == 0 => {
                if !current.trim().is_empty() {
                    statements.push(current.trim().to_string());
                }
                current.clear();
                continue;
            }
            _ => {}
        }
        current.push(character);
    }
    statements
}

fn top_level_equals(statement: &str) -> Option<usize> {
    let (mut brackets, mut parentheses, mut string, mut escaped) = (0_u32, 0_u32, false, false);
    for (index, character) in statement.char_indices() {
        if string {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                string = false;
            }
            continue;
        }
        match character {
            '"' => string = true,
            '[' => brackets += 1,
            ']' => brackets = brackets.saturating_sub(1),
            '(' => parentheses += 1,
            ')' => parentheses = parentheses.saturating_sub(1),
            '=' if brackets == 0 && parentheses == 0 => return Some(index),
            _ => {}
        }
    }
    None
}

fn extract_parameter_schema(source: &str) -> Vec<ParameterSchemaItem> {
    let mut seen = HashSet::new();
    let mut schema = Vec::new();
    for statement in top_level_statements(source) {
        let statement = statement.trim();
        if statement.starts_with("include ") || statement.starts_with("use ") {
            continue;
        }
        let Some(equals) = top_level_equals(statement) else {
            break;
        };
        let name = statement[..equals].trim();
        if !valid_parameter_name(name) {
            break;
        }
        if !seen.insert(name.to_string()) {
            continue;
        }
        let Some(default) = literal(&statement[equals + 1..]) else {
            continue;
        };
        let value_type = match &default {
            ParamValue::Number(_) => "number",
            ParamValue::Boolean(_) => "boolean",
            ParamValue::String(_) => "string",
            ParamValue::Vector(_) => "vector",
        };
        schema.push(ParameterSchemaItem {
            name: name.to_string(),
            value_type,
            default,
        });
    }
    schema
}

fn decode_stored_value(source: &str, reference: &ParamValue) -> Option<ParamValue> {
    match reference {
        ParamValue::String(_) => Some(ParamValue::String(source.to_string())),
        ParamValue::Boolean(_) => match source {
            "true" => Some(ParamValue::Boolean(true)),
            "false" => Some(ParamValue::Boolean(false)),
            _ => None,
        },
        ParamValue::Number(_) => source
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .map(ParamValue::Number),
        ParamValue::Vector(reference) => match literal(source)? {
            ParamValue::Vector(values) if values.len() == reference.len() => {
                Some(ParamValue::Vector(values))
            }
            _ => None,
        },
    }
}

fn decode_parameter_set(
    source: &str,
    set_name: &str,
    schema: &[ParameterSchemaItem],
) -> Result<BTreeMap<String, ParamValue>, CliError> {
    let root: Value = serde_json::from_str(source)
        .map_err(|_| CliError::operation("parameter-set file is not valid JSON"))?;
    let object = root
        .as_object()
        .ok_or_else(|| CliError::operation("parameter-set root must be an object"))?;
    if object.len() != 2 || object.get("fileFormatVersion").and_then(Value::as_str) != Some("1") {
        return Err(CliError::operation(
            "expected the exact OpenSCAD parameter-set JSON v1 shape",
        ));
    }
    let sets = object
        .get("parameterSets")
        .and_then(Value::as_object)
        .ok_or_else(|| CliError::operation("parameterSets must be an object"))?;
    let selected = sets
        .get(set_name)
        .and_then(Value::as_object)
        .ok_or_else(|| CliError::operation(format!("unknown parameter set: {set_name}")))?;
    let definitions = schema
        .iter()
        .map(|item| (item.name.as_str(), &item.default))
        .collect::<HashMap<_, _>>();
    let mut values = BTreeMap::new();
    for (name, stored) in selected {
        if !valid_parameter_name(name) {
            return Err(CliError::operation(
                "parameter set contains an invalid parameter name",
            ));
        }
        let Some(reference) = definitions.get(name.as_str()) else {
            continue;
        };
        let stored = stored.as_str().ok_or_else(|| {
            CliError::operation(format!("stored value for {name} must be a string"))
        })?;
        let value = decode_stored_value(stored, reference).ok_or_else(|| {
            CliError::operation(format!("stored value for {name} has the wrong type"))
        })?;
        values.insert(name.clone(), value);
    }
    Ok(values)
}

fn read_text(path: &Path, limit: u64, label: &str) -> Result<String, CliError> {
    let metadata = fs::metadata(path)
        .map_err(|error| CliError::operation(format!("could not read {label}: {error}")))?;
    if metadata.len() > limit {
        return Err(CliError::operation(format!(
            "{label} exceeds the supported size"
        )));
    }
    fs::read_to_string(path)
        .map_err(|error| CliError::operation(format!("could not read {label} as UTF-8: {error}")))
}

fn selected_parameters(
    arguments: &CliArguments,
    schema: &[ParameterSchemaItem],
) -> Result<BTreeMap<String, ParamValue>, CliError> {
    let Some(set_name) = arguments.parameter_set.as_deref() else {
        return Ok(BTreeMap::new());
    };
    let parameter_path = arguments
        .parameter_file
        .clone()
        .unwrap_or_else(|| arguments.input.with_extension("json"));
    decode_parameter_set(
        &read_text(&parameter_path, MAX_SCHEMA_BYTES, "parameter-set file")?,
        set_name,
        schema,
    )
}

fn skipped_directory(name: &str) -> bool {
    matches!(name, ".git" | ".scadmill-cache" | "node_modules" | "target")
}

fn collect_directory(
    root: &Path,
    directory: &Path,
    files: &mut BTreeMap<String, Vec<u8>>,
    count: &mut usize,
    total: &mut u64,
) -> Result<(), CliError> {
    let entries = fs::read_dir(directory)
        .map_err(|error| CliError::operation(format!("could not scan project: {error}")))?;
    for entry in entries {
        let entry = entry
            .map_err(|error| CliError::operation(format!("could not scan project: {error}")))?;
        let file_type = entry.file_type().map_err(|error| {
            CliError::operation(format!("could not inspect project file: {error}"))
        })?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            if !skipped_directory(&entry.file_name().to_string_lossy()) {
                collect_directory(root, &path, files, count, total)?;
            }
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        *count += 1;
        if *count > MAX_PROJECT_FILES {
            return Err(CliError::operation("project exceeds the 4096-file limit"));
        }
        let metadata = entry.metadata().map_err(|error| {
            CliError::operation(format!("could not inspect project file: {error}"))
        })?;
        *total = total
            .checked_add(metadata.len())
            .ok_or_else(|| CliError::operation("project size overflow"))?;
        if *total > MAX_PROJECT_BYTES {
            return Err(CliError::operation("project exceeds the 512 MiB limit"));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| CliError::operation("project path escaped its root"))?;
        let logical = relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        files.insert(
            logical,
            fs::read(&path).map_err(|error| {
                CliError::operation(format!("could not read project file: {error}"))
            })?,
        );
    }
    Ok(())
}

fn project_root(input: &Path) -> Result<PathBuf, CliError> {
    let input = input
        .canonicalize()
        .map_err(|error| CliError::operation(format!("could not resolve input file: {error}")))?;
    let parent = input
        .parent()
        .ok_or_else(|| CliError::operation("input file has no project directory"))?;
    Ok(parent
        .ancestors()
        .find(|directory| directory.join("scadmill.project.json").is_file())
        .unwrap_or(parent)
        .to_path_buf())
}

fn project_files(input: &Path) -> Result<(String, BTreeMap<String, Vec<u8>>), CliError> {
    let input = input
        .canonicalize()
        .map_err(|error| CliError::operation(format!("could not resolve input file: {error}")))?;
    let root = project_root(&input)?;
    let mut files = BTreeMap::new();
    let mut count = 0;
    let mut total = 0;
    collect_directory(&root, &root, &mut files, &mut count, &mut total)?;
    let entry = input
        .strip_prefix(&root)
        .map_err(|_| CliError::operation("input file escaped its project root"))?
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    if !files.contains_key(&entry) {
        return Err(CliError::operation(
            "input file was not collected from its project",
        ));
    }
    Ok((entry, files))
}

fn project_pin(input: &Path) -> Result<Option<String>, CliError> {
    let root = project_root(input)?;
    let manifest = root.join("scadmill.project.json");
    if !manifest.is_file() {
        return Ok(None);
    }
    let value: Value =
        serde_json::from_str(&read_text(&manifest, 16_384, "ScadMill project manifest")?)
            .map_err(|_| CliError::operation("ScadMill project manifest is invalid"))?;
    let object = value
        .as_object()
        .ok_or_else(|| CliError::operation("ScadMill project manifest is invalid"))?;
    if object.len() != 2 || object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(CliError::operation("ScadMill project manifest is invalid"));
    }
    let version = object
        .get("engineVersion")
        .and_then(Value::as_str)
        .ok_or_else(|| CliError::operation("ScadMill project manifest is invalid"))?;
    if version.is_empty()
        || version.len() > 64
        || !version.chars().enumerate().all(|(index, character)| {
            character.is_ascii_alphanumeric()
                || (index > 0 && matches!(character, '.' | '_' | '+' | '-'))
        })
    {
        return Err(CliError::operation("ScadMill project manifest is invalid"));
    }
    Ok(Some(version.to_string()))
}

fn managed_engine(version: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from).map(|root| {
            root.join("dev.scadmill.desktop/engines")
                .join(version)
                .join("openscad.exe")
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let root = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".local/share"))
            })?;
        Some(
            root.join("dev.scadmill.desktop/engines")
                .join(version)
                .join("openscad"),
        )
    }
}

fn resolve_engine(input: &Path) -> Result<(PathBuf, String), CliError> {
    let required = project_pin(input)?.unwrap_or_else(|| PINNED_VERSION.to_string());
    let engine = managed_engine(&required)
        .filter(|path| path.is_file())
        .map(Ok)
        .unwrap_or_else(|| find_engine(None))
        .map_err(|error| CliError::operation(error.to_string()))?;
    let actual = engine_version(&engine).map_err(|error| CliError::operation(error.to_string()))?;
    if actual != required {
        return Err(CliError::operation(format!(
            "OpenSCAD {actual} is available, but this command requires {required}"
        )));
    }
    Ok((engine, actual))
}

fn export_format(
    value: Option<&str>,
    output: &Path,
) -> Result<(NativeExportFormat, &'static str), CliError> {
    let selected = value
        .or_else(|| output.extension().and_then(|extension| extension.to_str()))
        .unwrap_or("3mf")
        .to_ascii_lowercase();
    match selected.as_str() {
        "3mf" => Ok((NativeExportFormat::ThreeMf, "3mf")),
        "stl" | "binstl" => Ok((NativeExportFormat::StlBinary, "stl")),
        "asciistl" => Ok((NativeExportFormat::StlAscii, "stl")),
        "off" => Ok((NativeExportFormat::Off, "off")),
        "amf" => Ok((NativeExportFormat::Amf, "amf")),
        "svg" => Ok((NativeExportFormat::Svg, "svg")),
        "dxf" => Ok((NativeExportFormat::Dxf, "dxf")),
        "png" => Ok((NativeExportFormat::Png, "png")),
        _ => Err(CliError::usage(format!(
            "unsupported export format: {selected}"
        ))),
    }
}

fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn export_destination(
    output: &Path,
    input: &Path,
    extension: &str,
    set_name: Option<&str>,
) -> PathBuf {
    if !output.is_dir() && output.extension().is_some() {
        return output.to_path_buf();
    }
    let stem = input
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("model");
    let suffix = set_name
        .map(|name| format!("-{}", safe_name(name)))
        .unwrap_or_default();
    output.join(format!("{stem}{suffix}.{extension}"))
}

type VertexKey = [u32; 3];
fn vertex_key(point: [f32; 3]) -> VertexKey {
    point.map(|value| {
        if value == 0.0 {
            0.0_f32.to_bits()
        } else {
            value.to_bits()
        }
    })
}
fn edge_key(left: usize, right: usize) -> (usize, usize) {
    if left < right {
        (left, right)
    } else {
        (right, left)
    }
}

fn printability(mesh: &[u8], build_volume: [f64; 3], nozzle: f64) -> Result<Value, CliError> {
    let parsed = scadmill_native_engine::parse_binary_stl(mesh)
        .map_err(|error| CliError::operation(error.to_string()))?;
    let mut vertices = Vec::<[f32; 3]>::new();
    let mut ids = HashMap::<VertexKey, usize>::new();
    let mut edge_counts = HashMap::<(usize, usize), usize>::new();
    for triangle in 0..parsed.triangle_count as usize {
        let mut triangle_ids = [0_usize; 3];
        for (vertex, slot) in triangle_ids.iter_mut().enumerate() {
            let offset = 84 + triangle * 50 + 12 + vertex * 12;
            let point = [0, 1, 2].map(|axis| {
                f32::from_le_bytes(
                    mesh[offset + axis * 4..offset + axis * 4 + 4]
                        .try_into()
                        .expect("validated STL"),
                )
            });
            let key = vertex_key(point);
            *slot = *ids.entry(key).or_insert_with(|| {
                vertices.push(point);
                vertices.len() - 1
            });
        }
        for edge in [
            (triangle_ids[0], triangle_ids[1]),
            (triangle_ids[1], triangle_ids[2]),
            (triangle_ids[2], triangle_ids[0]),
        ] {
            *edge_counts.entry(edge_key(edge.0, edge.1)).or_default() += 1;
        }
    }
    let boundary_edges = edge_counts.values().filter(|count| **count == 1).count();
    let non_manifold_edges = edge_counts
        .values()
        .filter(|count| **count != 1 && **count != 2)
        .count();
    let manifold = boundary_edges == 0 && non_manifold_edges == 0;
    let model_size = parsed.bounds.size.map(f64::from);
    let volume_pass = model_size
        .iter()
        .enumerate()
        .all(|(axis, size)| *size <= build_volume[axis]);
    let minimum_feature = if vertices.len() > MAX_FEATURE_VERTICES {
        json!({"status":"not-checked","reason":format!("mesh exceeds the {MAX_FEATURE_VERTICES}-vertex heuristic limit")})
    } else {
        let adjacency = edge_counts.keys().copied().collect::<HashSet<_>>();
        let mut cells = HashMap::<(i64, i64, i64), Vec<usize>>::new();
        let mut detected: Option<f64> = None;
        for (id, point) in vertices.iter().enumerate() {
            let cell = point.map(|value| (f64::from(value) / nozzle).floor() as i64);
            for x in -1..=1 {
                for y in -1..=1 {
                    for z in -1..=1 {
                        if let Some(candidates) =
                            cells.get(&(cell[0] + x, cell[1] + y, cell[2] + z))
                        {
                            for candidate in candidates {
                                if adjacency.contains(&edge_key(id, *candidate)) {
                                    continue;
                                }
                                let other = vertices[*candidate];
                                let distance = ((f64::from(point[0] - other[0])).powi(2)
                                    + (f64::from(point[1] - other[1])).powi(2)
                                    + (f64::from(point[2] - other[2])).powi(2))
                                .sqrt();
                                if distance > 0.0
                                    && distance < nozzle
                                    && detected.is_none_or(|current| distance < current)
                                {
                                    detected = Some(distance);
                                }
                            }
                        }
                    }
                }
            }
            cells
                .entry((cell[0], cell[1], cell[2]))
                .or_default()
                .push(id);
        }
        if let Some(distance) = detected {
            json!({"status":"warning","detectedMm":distance,"nozzleDiameterMm":nozzle})
        } else if manifold {
            json!({"status":"pass","nozzleDiameterMm":nozzle})
        } else {
            json!({"status":"not-checked","reason":"no non-adjacent surface samples were available"})
        }
    };
    Ok(json!({
        "manifold":{"status":if manifold {"pass"} else {"fail"},"boundaryEdges":boundary_edges,"nonManifoldEdges":non_manifold_edges},
        "buildVolume":{"status":if volume_pass {"pass"} else {"fail"},"modelSizeMm":model_size,"configuredMm":build_volume},
        "minimumFeature":minimum_feature,
        "overhangs":{"status":"not-checked"}
    }))
}

fn execute(arguments: CliArguments) -> Result<Value, CliError> {
    if arguments.command == CommandKind::Help {
        return Ok(
            json!({"ok":true,"usage":"scadmill render|export|params|check <file> [--set NAME] [--param-file FILE] [-o PATH] [--format FORMAT]"}),
        );
    }
    if arguments.command == CommandKind::Version {
        return Ok(json!({"ok":true,"product":"ScadMill","version":env!("CARGO_PKG_VERSION")}));
    }
    let source = read_text(&arguments.input, MAX_SCHEMA_BYTES, "OpenSCAD source")?;
    let schema = extract_parameter_schema(&source);
    if arguments.command == CommandKind::Params {
        return Ok(
            json!({"ok":true,"command":"params","file":arguments.input,"parameters":schema}),
        );
    }
    let parameters = selected_parameters(&arguments, &schema)?;
    let (entry, files) = project_files(&arguments.input)?;
    let (engine, version) = resolve_engine(&arguments.input)?;
    let cancelled = AtomicBool::new(false);
    if arguments.command == CommandKind::Export {
        let output = arguments.output.as_ref().expect("validated export output");
        let (format, extension) = export_format(arguments.format.as_deref(), output)?;
        let destination = export_destination(
            output,
            &arguments.input,
            extension,
            arguments.parameter_set.as_deref(),
        );
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                CliError::operation(format!("could not create export directory: {error}"))
            })?;
        }
        let exported = export_project(
            &engine,
            &entry,
            &files,
            &parameters,
            format,
            None,
            Duration::from_secs(600),
            &cancelled,
            &|_| {},
        )
        .map_err(|error| CliError::operation(error.to_string()))?;
        fs::write(&destination, &exported.bytes)
            .map_err(|error| CliError::operation(format!("could not write export: {error}")))?;
        return Ok(
            json!({"ok":true,"command":"export","engineVersion":version,"format":extension,"output":destination,"bytes":exported.bytes.len(),"engineTimeMs":exported.engine_time_ms,"parameterSet":arguments.parameter_set}),
        );
    }
    let rendered = render_project(
        &engine,
        &entry,
        &files,
        RenderQuality::Full,
        &parameters,
        None,
        Duration::from_secs(600),
        &cancelled,
        &|_| {},
    )
    .map_err(|error| CliError::operation(error.to_string()))?;
    match (arguments.command, rendered.geometry) {
        (CommandKind::Render, NativeGeometry::ThreeD { geometry, .. }) => Ok(
            json!({"ok":true,"command":"render","engineVersion":version,"kind":"3d","triangles":geometry.triangle_count,"bounds":geometry.bounds,"volumeMm3":geometry.volume_mm3,"engineTimeMs":rendered.engine_time_ms,"parameterSet":arguments.parameter_set}),
        ),
        (CommandKind::Render, NativeGeometry::TwoD { bounds, .. }) => Ok(
            json!({"ok":true,"command":"render","engineVersion":version,"kind":"2d","bounds":bounds,"engineTimeMs":rendered.engine_time_ms,"parameterSet":arguments.parameter_set}),
        ),
        (CommandKind::Check, NativeGeometry::ThreeD { mesh, .. }) => Ok(
            json!({"ok":true,"command":"check","engineVersion":version,"report":printability(&mesh, arguments.build_volume, arguments.nozzle)?}),
        ),
        (CommandKind::Check, NativeGeometry::TwoD { .. }) => Err(CliError::operation(
            "printability check requires a 3D model",
        )),
        _ => unreachable!("validated command"),
    }
}

const USAGE: &str = "Usage: scadmill render|export|params|check <file> [options]";

pub fn run_headless_cli(arguments: impl IntoIterator<Item = OsString>) -> i32 {
    let result = parse_arguments(arguments).and_then(execute);
    let (value, code) = match result {
        Ok(value) => (value, 0),
        Err(error) => (
            json!({"ok":false,"error":error.message,"usage":if error.usage { Some(USAGE) } else { None }}),
            if error.usage { 2 } else { 1 },
        ),
    };
    let target: &mut dyn Write = if code == 0 {
        &mut io::stdout()
    } else {
        &mut io::stderr()
    };
    let _ = serde_json::to_writer(&mut *target, &value);
    let _ = writeln!(target);
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_normative_export_command() {
        let parsed = parse_arguments(["export", "--set", "thick", "fixture.scad", "-o", "out/"])
            .expect("valid command");
        assert_eq!(parsed.command, CommandKind::Export);
        assert_eq!(parsed.parameter_set.as_deref(), Some("thick"));
        assert_eq!(parsed.input, Path::new("fixture.scad"));
        assert_eq!(parsed.output.as_deref(), Some(Path::new("out/")));
    }

    #[test]
    fn extracts_only_top_level_literal_customizer_parameters() {
        let source = "include <shared.scad>\n// Width\nwidth = 10; // [1:0.5:20]\nlabel = \"géar\";\nenabled = true;\npoints = [1, 2, 3];\ncube(1);\nlate = 99;\nmodule hidden() { nested = 99; }";
        let schema = extract_parameter_schema(source);
        assert_eq!(
            schema
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["width", "label", "enabled", "points"]
        );
        assert_eq!(schema[1].default, ParamValue::String("géar".to_string()));
    }

    #[test]
    fn decodes_an_exact_openscad_parameter_set_against_the_schema() {
        let schema = extract_parameter_schema("width = 10; enabled = true; label = \"gear\";");
        let json = r#"{"parameterSets":{"thick":{"width":"20","enabled":"false","label":"final"}},"fileFormatVersion":"1"}"#;
        let values = decode_parameter_set(json, "thick", &schema).expect("valid set");
        assert_eq!(values.get("width"), Some(&ParamValue::Number(20.0)));
        assert_eq!(values.get("enabled"), Some(&ParamValue::Boolean(false)));
        assert_eq!(
            values.get("label"),
            Some(&ParamValue::String("final".to_string()))
        );
    }

    #[test]
    fn treats_an_extensionless_output_as_a_directory_for_the_default_3mf() {
        assert_eq!(
            export_destination(
                Path::new("out"),
                Path::new("fixture.scad"),
                "3mf",
                Some("thick")
            ),
            Path::new("out").join("fixture-thick.3mf")
        );
        assert_eq!(
            export_destination(
                Path::new("part.stl"),
                Path::new("fixture.scad"),
                "stl",
                None
            ),
            Path::new("part.stl")
        );
    }

    #[test]
    fn treats_an_existing_dotted_output_directory_as_a_directory() {
        let root = std::env::temp_dir().join(format!("scadmill-cli-dotted-{}", std::process::id()));
        let output = root.join("exports.v1");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&output).expect("fixture directory");

        assert_eq!(
            export_destination(&output, Path::new("fixture.scad"), "3mf", Some("thick")),
            output.join("fixture-thick.3mf")
        );

        fs::remove_dir_all(root).expect("fixture cleanup");
    }

    #[test]
    fn uses_the_manifest_directory_as_the_project_root_for_nested_models() {
        let root = std::env::temp_dir().join(format!("scadmill-cli-root-{}", std::process::id()));
        let model_directory = root.join("models");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&model_directory).expect("fixture directory");
        fs::write(
            root.join("scadmill.project.json"),
            r#"{"schemaVersion":1,"engineVersion":"2026.06.12"}"#,
        )
        .expect("project manifest");
        fs::write(root.join("shared.scad"), "module shared() { cube(1); }").expect("shared source");
        let model = model_directory.join("fixture.scad");
        fs::write(&model, "include <../shared.scad>; shared();").expect("model source");

        let (entry, files) = project_files(&model).expect("project snapshot");
        assert_eq!(entry, "models/fixture.scad");
        assert!(files.contains_key("shared.scad"));
        assert_eq!(
            project_pin(&model).expect("project pin").as_deref(),
            Some("2026.06.12")
        );

        fs::remove_dir_all(root).expect("fixture cleanup");
    }
}
