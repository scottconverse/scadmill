use scadmill_native_engine::{
    EngineError, NativeGeometry, ParamValue, ProjectRenderOutput, RenderQuality, find_engine,
    render_project, render_project_colored,
};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

fn render(
    entry_file: &str,
    files: BTreeMap<String, Vec<u8>>,
    quality: RenderQuality,
) -> Result<ProjectRenderOutput, EngineError> {
    let engine = find_engine(None)?;
    render_project(
        &engine,
        entry_file,
        &files,
        quality,
        &BTreeMap::<String, ParamValue>::new(),
        Some(48),
        Duration::from_secs(30),
        &AtomicBool::new(false),
        &|_| {},
    )
}

#[test]
fn renders_two_colored_solids_as_a_color_encoded_3mf() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let rendered = render_project_colored(
        &engine,
        "main.scad",
        &BTreeMap::from([(
            "main.scad".to_string(),
            b"color(\"red\") cube(10); translate([20,0,0]) color(\"blue\") cube(10);".to_vec(),
        )]),
        RenderQuality::Full,
        &BTreeMap::new(),
        None,
        Duration::from_secs(30),
        &AtomicBool::new(false),
        &|_| {},
    )
    .expect("color render should succeed");

    match rendered.geometry {
        NativeGeometry::ThreeMf { archive } => {
            assert_eq!(&archive[..2], b"PK");
            assert!(archive.len() > 100);
        }
        other => panic!("expected 3MF geometry, got {other:?}"),
    }
}

#[test]
fn cancels_a_slow_minkowski_within_two_seconds_and_allows_the_next_render() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let cancelled = Arc::new(AtomicBool::new(false));
    let trigger = Arc::clone(&cancelled);
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        trigger.store(true, Ordering::Release);
    });
    let files = BTreeMap::from([(
        "main.scad".to_string(),
        b"$fn=400; minkowski() { sphere(10); cube([20,20,20], center=true); }".to_vec(),
    )]);
    let started = Instant::now();

    let result = render_project(
        &engine,
        "main.scad",
        &files,
        RenderQuality::Full,
        &BTreeMap::new(),
        None,
        Duration::from_secs(30),
        &cancelled,
        &|_| {},
    );
    canceller.join().expect("canceller should finish");

    assert!(
        matches!(result, Err(EngineError::Cancelled { .. })),
        "{result:?}"
    );
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "cancellation took {:?}",
        started.elapsed()
    );
    let next = render(
        "main.scad",
        BTreeMap::from([("main.scad".to_string(), b"cube(10);".to_vec())]),
        RenderQuality::Full,
    )
    .expect("a render after cancellation should succeed");
    assert!(matches!(next.geometry, NativeGeometry::ThreeD { .. }));
}

fn malformed_output_engine(root: &Path) -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let path = root.join("malformed-engine.cmd");
        fs::write(
            &path,
            "@echo off\r\nset output=\r\n:args\r\nif \"%~1\"==\"\" goto done\r\nif \"%~1\"==\"-o\" set \"output=%~2\"\r\nshift\r\ngoto args\r\n:done\r\n>\"%output%\" echo not-an-stl\r\n>&2 echo SENTINEL COMPLETE ENGINE LOG\r\nexit /b 0\r\n",
        )
        .expect("write fake engine");
        path
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let path = root.join("malformed-engine.sh");
        let staged_path = root.join("malformed-engine.sh.new");
        fs::write(
            &staged_path,
            "#!/bin/sh\nwhile [ \"$#\" -gt 0 ]; do\n  if [ \"$1\" = \"-o\" ]; then output=$2; fi\n  shift\ndone\nprintf 'not-an-stl' > \"$output\"\nprintf 'SENTINEL COMPLETE ENGINE LOG\\n' >&2\n",
        )
        .expect("write fake engine");
        fs::set_permissions(&staged_path, fs::Permissions::from_mode(0o755))
            .expect("make fake engine executable");
        fs::rename(&staged_path, &path).expect("atomically publish fake engine");
        path
    }
}

#[test]
fn preserves_engine_log_when_rendered_artifact_is_malformed() {
    let root = tempfile::tempdir().expect("fake engine root");
    let engine = malformed_output_engine(root.path());
    let error = render_project(
        &engine,
        "main.scad",
        &BTreeMap::from([("main.scad".to_string(), b"cube(1);".to_vec())]),
        RenderQuality::Full,
        &BTreeMap::new(),
        None,
        Duration::from_secs(2),
        &AtomicBool::new(false),
        &|_| {},
    )
    .expect_err("malformed engine output should fail");

    assert!(
        format!("{error:?}").contains("SENTINEL COMPLETE ENGINE LOG"),
        "captured engine log was discarded: {error:?}"
    );
}

#[test]
fn stages_nested_project_files_and_resolves_include_from_project_root() {
    let files = BTreeMap::from([
        (
            "main.scad".to_string(),
            b"include <parts/body.scad>; body();".to_vec(),
        ),
        (
            "parts/body.scad".to_string(),
            b"module body() { cube([7, 8, 9]); }".to_vec(),
        ),
    ]);

    let rendered =
        render("main.scad", files, RenderQuality::Full).expect("the staged include should render");

    match rendered.geometry {
        NativeGeometry::ThreeD { geometry, .. } => {
            assert_eq!(geometry.bounds.size, [7.0, 8.0, 9.0]);
        }
        other => panic!("expected 3D geometry, got {other:?}"),
    }
}

#[test]
fn applies_typed_parameter_overrides_to_a_real_render() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let files = BTreeMap::from([(
        "main.scad".to_string(),
        b"size = 2; cube([size, size + 1, size + 2]);".to_vec(),
    )]);
    let parameters = BTreeMap::from([("size".to_string(), ParamValue::Number(7.0))]);

    let rendered = render_project(
        &engine,
        "main.scad",
        &files,
        RenderQuality::Full,
        &parameters,
        None,
        Duration::from_secs(30),
        &AtomicBool::new(false),
        &|_| {},
    )
    .expect("the parameterized project should render");

    match rendered.geometry {
        NativeGeometry::ThreeD { geometry, .. } => {
            assert_eq!(geometry.bounds.size, [7.0, 8.0, 9.0]);
        }
        other => panic!("expected 3D geometry, got {other:?}"),
    }
}

#[test]
fn decides_two_dimensions_from_engine_output_and_returns_svg_bounds() {
    let files = BTreeMap::from([(
        "drawings/plate.scad".to_string(),
        b"translate([2, 3]) square([10, 20]);".to_vec(),
    )]);

    let rendered = render("drawings/plate.scad", files, RenderQuality::Preview)
        .expect("the 2D project should render");

    match rendered.geometry {
        NativeGeometry::TwoD { svg, bounds } => {
            assert!(svg.contains("<svg"));
            assert_eq!(bounds.min, [2.0, 3.0]);
            assert_eq!(bounds.max, [12.0, 23.0]);
        }
        other => panic!("expected 2D geometry, got {other:?}"),
    }
    assert!(
        rendered.raw_log.contains("not a 3D object"),
        "the discriminator probe must remain represented in the raw run log"
    );
}

#[test]
fn stages_binary_assets_without_utf8_coercion() {
    let tetrahedron = b"solid tetra\n\
facet normal 0 0 -1\n outer loop\n  vertex 0 0 0\n  vertex 0 1 0\n  vertex 1 0 0\n endloop\nendfacet\n\
facet normal 0 -1 0\n outer loop\n  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 0 1\n endloop\nendfacet\n\
facet normal -1 0 0\n outer loop\n  vertex 0 0 0\n  vertex 0 0 1\n  vertex 0 1 0\n endloop\nendfacet\n\
facet normal 1 1 1\n outer loop\n  vertex 1 0 0\n  vertex 0 1 0\n  vertex 0 0 1\n endloop\nendfacet\n\
endsolid tetra\n";
    let files = BTreeMap::from([
        (
            "main.scad".to_string(),
            b"import(\"assets/tetra.stl\");".to_vec(),
        ),
        ("assets/tetra.stl".to_string(), tetrahedron.to_vec()),
    ]);

    let rendered = render("main.scad", files, RenderQuality::Full)
        .expect("the staged binary asset should render");

    assert!(matches!(rendered.geometry, NativeGeometry::ThreeD { .. }));
}

#[test]
fn rejects_absolute_parent_and_missing_entry_paths_before_starting_the_engine() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let cancellation = AtomicBool::new(false);
    for (entry_file, files) in [
        (
            "../outside.scad",
            BTreeMap::from([("../outside.scad".to_string(), b"cube(1);".to_vec())]),
        ),
        (
            "C:/outside.scad",
            BTreeMap::from([("C:/outside.scad".to_string(), b"cube(1);".to_vec())]),
        ),
        (
            "missing.scad",
            BTreeMap::from([("main.scad".to_string(), b"cube(1);".to_vec())]),
        ),
    ] {
        let result = render_project(
            &engine,
            entry_file,
            &files,
            RenderQuality::Full,
            &BTreeMap::new(),
            None,
            Duration::from_secs(30),
            &cancellation,
            &|_| {},
        );

        assert!(
            matches!(result, Err(EngineError::InvalidProject { .. })),
            "unexpected result for {entry_file}: {result:?}"
        );
    }
}

#[test]
fn reports_an_included_file_error_with_its_project_relative_path() {
    let files = BTreeMap::from([
        (
            "main.scad".to_string(),
            b"include <parts/broken.scad>; broken();".to_vec(),
        ),
        (
            "parts/broken.scad".to_string(),
            b"module broken() {\n  cube(10)\n}".to_vec(),
        ),
    ]);

    let error = render("main.scad", files, RenderQuality::Full)
        .expect_err("the included parser error should fail the render");

    match error {
        EngineError::Process { log, .. } => {
            assert!(
                log.contains("parts/broken.scad, line 3"),
                "unexpected log: {log}"
            );
            assert!(
                !log.contains("scadmill"),
                "temporary workspace leaked: {log}"
            );
        }
        other => panic!("expected a typed engine process error, got {other:?}"),
    }
}

#[test]
fn rejects_a_file_that_is_also_a_parent_directory_before_starting_the_engine() {
    let result = render_project(
        Path::new("definitely-missing-openscad"),
        "main.scad",
        &BTreeMap::from([
            ("main.scad".to_string(), b"cube(1);".to_vec()),
            ("parts".to_string(), b"not a directory".to_vec()),
            ("parts/body.scad".to_string(), b"cube(2);".to_vec()),
        ]),
        RenderQuality::Full,
        &BTreeMap::new(),
        None,
        Duration::from_secs(1),
        &AtomicBool::new(false),
        &|_| {},
    );

    assert!(
        matches!(
            result,
            Err(EngineError::InvalidProject {
                ref path,
                detail: "a project file path is also a parent directory",
            }) if path == "parts"
        ),
        "unexpected result: {result:?}"
    );
}

#[cfg(windows)]
#[test]
fn rejects_case_insensitive_path_collisions_before_starting_the_engine() {
    let result = render_project(
        Path::new("definitely-missing-openscad"),
        "main.scad",
        &BTreeMap::from([
            ("main.scad".to_string(), b"cube(1);".to_vec()),
            ("Parts/body.scad".to_string(), b"cube(2);".to_vec()),
            ("parts/body.scad".to_string(), b"cube(3);".to_vec()),
        ]),
        RenderQuality::Full,
        &BTreeMap::new(),
        None,
        Duration::from_secs(1),
        &AtomicBool::new(false),
        &|_| {},
    );

    assert!(
        matches!(
            result,
            Err(EngineError::InvalidProject {
                ref path,
                detail: "project file paths collide on this platform",
            }) if path == "parts/body.scad"
        ),
        "unexpected result: {result:?}"
    );
}

#[cfg(windows)]
#[test]
fn rejects_case_insensitive_file_directory_collisions() {
    let result = render_project(
        Path::new("definitely-missing-openscad"),
        "main.scad",
        &BTreeMap::from([
            ("main.scad".to_string(), b"cube(1);".to_vec()),
            ("Parts".to_string(), b"not a directory".to_vec()),
            ("parts/body.scad".to_string(), b"cube(2);".to_vec()),
        ]),
        RenderQuality::Full,
        &BTreeMap::new(),
        None,
        Duration::from_secs(1),
        &AtomicBool::new(false),
        &|_| {},
    );

    assert!(
        matches!(
            result,
            Err(EngineError::InvalidProject {
                ref path,
                detail: "a project file path is also a parent directory",
            }) if path == "Parts"
        ),
        "unexpected result: {result:?}"
    );
}
