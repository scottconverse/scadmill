use serde_json::Value;
use std::fs;
use std::process::Command;

#[test]
fn params_command_emits_json_and_returns_without_opening_the_desktop() {
    let root = std::env::temp_dir().join(format!("scadmill-cli-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("fixture directory");
    let model = root.join("fixture.scad");
    fs::write(&model, "width = 10; label = \"géar\"; cube(width);").expect("fixture source");

    let output = Command::new(env!("CARGO_BIN_EXE_scadmill"))
        .arg("params")
        .arg(&model)
        .output()
        .expect("headless command");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let response: Value = serde_json::from_slice(&output.stdout).expect("JSON stdout");
    assert_eq!(response["ok"], true);
    assert_eq!(response["command"], "params");
    assert_eq!(response["parameters"][0]["name"], "width");
    assert_eq!(response["parameters"][1]["default"], "géar");

    fs::remove_dir_all(root).expect("fixture cleanup");
}

#[test]
fn malformed_headless_invocation_is_machine_readable_and_nonzero() {
    let output = Command::new(env!("CARGO_BIN_EXE_scadmill"))
        .args(["export", "fixture.scad"])
        .output()
        .expect("headless command");
    assert_eq!(output.status.code(), Some(2));
    let response: Value = serde_json::from_slice(&output.stderr).expect("JSON stderr");
    assert_eq!(response["ok"], false);
    assert!(
        response["usage"]
            .as_str()
            .is_some_and(|value| value.starts_with("Usage:"))
    );
}

#[test]
#[ignore = "requires the exact pinned OpenSCAD engine; CI runs this test explicitly"]
fn exports_a_named_parameter_set_to_3mf_without_a_display_server() {
    let engine = std::env::var_os("SCADMILL_OPENSCAD")
        .expect("SCADMILL_OPENSCAD must identify the exact pinned engine");
    let root = std::env::temp_dir().join(format!("scadmill-cli-export-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("fixture directory");
    let model = root.join("fixture.scad");
    fs::write(&model, "thickness = 10; cube([thickness, 10, 10]);").expect("fixture source");
    fs::write(
        root.join("fixture.json"),
        r#"{"parameterSets":{"thick":{"thickness":"20"}},"fileFormatVersion":"1"}"#,
    )
    .expect("parameter-set fixture");
    let output_directory = root.join("out");

    let output = Command::new(env!("CARGO_BIN_EXE_scadmill"))
        .args(["export", "--set", "thick"])
        .arg(&model)
        .args(["-o"])
        .arg(&output_directory)
        .env("SCADMILL_OPENSCAD", engine)
        .env_remove("DISPLAY")
        .output()
        .expect("headless export command");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let response: Value = serde_json::from_slice(&output.stdout).expect("JSON stdout");
    let artifact = output_directory.join("fixture-thick.3mf");
    assert_eq!(response["ok"], true);
    assert_eq!(response["command"], "export");
    assert_eq!(response["format"], "3mf");
    assert_eq!(response["parameterSet"], "thick");
    assert_eq!(response["output"], artifact.to_string_lossy().as_ref());
    let bytes = fs::read(&artifact).expect("exported 3MF");
    assert!(bytes.len() > 100, "3MF artifact should not be empty");
    assert_eq!(&bytes[..2], b"PK", "3MF must be a ZIP package");

    fs::remove_dir_all(root).expect("fixture cleanup");
}
