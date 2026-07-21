use scadmill_native_engine::{engine_version, find_engine};

const PINNED_OPENSCAD_VERSION: &str = "2026.06.12";

#[test]
fn native_acceptance_uses_the_exact_recorded_engine_snapshot() {
    let engine = find_engine(None).expect("the pinned engine should be installed");
    let actual = engine_version(&engine).expect("the engine version should be readable");

    assert_eq!(
        actual,
        PINNED_OPENSCAD_VERSION,
        "native acceptance must not run against a different OpenSCAD build: {}",
        engine.display()
    );
}
