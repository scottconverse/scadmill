use scadmill_native_engine::{
    ExportImage, NativeExportFormat, ParamValue, export_project, find_engine,
};
use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

#[test]
fn exports_svg_and_ascii_stl_at_full_quality() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let cancellation = AtomicBool::new(false);
    let parameters = BTreeMap::<String, ParamValue>::new();

    let svg = export_project(
        &engine,
        "drawing.scad",
        &BTreeMap::from([("drawing.scad".to_string(), b"square([4, 5]);".to_vec())]),
        &parameters,
        NativeExportFormat::Svg,
        None,
        Duration::from_secs(30),
        &cancellation,
        &|_| {},
    )
    .expect("SVG export should succeed");
    assert_eq!(svg.file_extension, "svg");
    assert!(
        String::from_utf8(svg.bytes)
            .expect("SVG is UTF-8")
            .contains("<svg")
    );

    let stl = export_project(
        &engine,
        "solid.scad",
        &BTreeMap::from([("solid.scad".to_string(), b"cube(3);".to_vec())]),
        &parameters,
        NativeExportFormat::StlAscii,
        None,
        Duration::from_secs(30),
        &cancellation,
        &|_| {},
    )
    .expect("ASCII STL export should succeed");
    assert_eq!(stl.file_extension, "stl");
    assert!(
        String::from_utf8(stl.bytes)
            .expect("ASCII STL is UTF-8")
            .starts_with("solid ")
    );
}

#[test]
fn exports_a_binary_stl_cube_with_twelve_triangles() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let exported = export_project(
        &engine,
        "cube.scad",
        &BTreeMap::from([("cube.scad".to_string(), b"cube(10);".to_vec())]),
        &BTreeMap::<String, ParamValue>::new(),
        NativeExportFormat::StlBinary,
        None,
        Duration::from_secs(30),
        &AtomicBool::new(false),
        &|_| {},
    )
    .expect("binary STL export should succeed");

    assert_eq!(exported.file_extension, "stl");
    assert!(exported.bytes.len() >= 84, "binary STL header is missing");
    assert_eq!(
        u32::from_le_bytes(exported.bytes[80..84].try_into().unwrap()),
        12
    );
    assert_eq!(exported.bytes.len(), 84 + 12 * 50);
}

#[test]
fn exports_a_real_png_without_an_explicit_camera() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let png = export_project(
        &engine,
        "solid.scad",
        &BTreeMap::from([("solid.scad".to_string(), b"cube([3, 4, 5]);".to_vec())]),
        &BTreeMap::<String, ParamValue>::new(),
        NativeExportFormat::Png,
        Some(ExportImage {
            width: 96,
            height: 64,
            camera: None,
        }),
        Duration::from_secs(30),
        &AtomicBool::new(false),
        &|_| {},
    )
    .expect("PNG export without an explicit camera should succeed");

    assert_eq!(png.file_extension, "png");
    assert_eq!(&png.bytes[..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(
        u32::from_be_bytes(png.bytes[16..20].try_into().unwrap()),
        96
    );
    assert_eq!(
        u32::from_be_bytes(png.bytes[20..24].try_into().unwrap()),
        64
    );
}
