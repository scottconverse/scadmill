use scadmill_native_engine::{RenderQuality, find_engine, render_scad};

struct FormatterGeometryFixture {
    id: &'static str,
    input: &'static str,
    expected: &'static str,
}

const FIXTURES: &[FormatterGeometryFixture] = &[
    FormatterGeometryFixture {
        id: "E4 one statement per line",
        input: "cube(1); sphere(2); cylinder(h = 3, r = 1);",
        expected: "cube(1);\nsphere(2);\ncylinder(h = 3, r = 1);",
    },
    FormatterGeometryFixture {
        id: "E7 transform chain",
        input: "translate([0,0,5]) rotate([0,90,0]) cylinder(h=10,r=2);",
        expected: "translate([0, 0, 5])\n    rotate([0, 90, 0])\n    cylinder(h = 10, r = 2);",
    },
    FormatterGeometryFixture {
        id: "E8 single transform inline",
        input: "translate([0,0,5])cube(10);",
        expected: "translate([0, 0, 5]) cube(10);",
    },
    FormatterGeometryFixture {
        id: "E11 modifier characters",
        input: "#  cube(5);\n!translate([1,0,0]) sphere(2);",
        expected: "#cube(5);\n!translate([1, 0, 0]) sphere(2);",
    },
];

#[test]
fn formatter_goldens_preserve_byte_identical_stl_geometry() {
    let engine = find_engine(None).expect("the pinned engine should be installed");

    for fixture in FIXTURES {
        let before = render_scad(&engine, fixture.input, RenderQuality::Full)
            .unwrap_or_else(|error| panic!("{} input render failed: {error}", fixture.id));
        let after = render_scad(&engine, fixture.expected, RenderQuality::Full)
            .unwrap_or_else(|error| panic!("{} formatted render failed: {error}", fixture.id));

        assert_eq!(
            before.mesh, after.mesh,
            "{} changed the exact STL bytes",
            fixture.id
        );
    }
}
