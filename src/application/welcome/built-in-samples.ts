export interface BuiltInSample {
  readonly id: "parametric-box" | "gear-knob" | "mounting-plate";
  readonly name: string;
  readonly summary: string;
  readonly path: string;
  readonly dimension: "2d" | "3d";
  readonly source: string;
}

const PARAMETRIC_BOX = `// Parametric storage box with optional lid.

/* [Size] */
width = 60;        // [20:200]
depth = 40;        // [20:200]
height = 30;       // [10:120]
wall = 2.4;        // [1.2:0.4:6]

/* [Style] */
corner = "round";  // [round:Rounded, square:Square]
corner_radius = 6; // [2:20]
with_lid = true;

/* [Hidden] */
eps = 0.01;
$fn = 48;

module shell(w, d, h, r) {
    if (corner == "round") {
        linear_extrude(h)
            offset(r = r)
            square([w - 2 * r, d - 2 * r], center = true);
    } else {
        linear_extrude(h) square([w, d], center = true);
    }
}

module box() {
    difference() {
        shell(width, depth, height, corner_radius);
        translate([0, 0, wall])
            shell(width - 2 * wall, depth - 2 * wall, height, corner_radius);
    }
}

module lid() {
    lip = wall * 0.8;
    union() {
        shell(width, depth, wall, corner_radius);
        translate([0, 0, wall - eps])
            difference() {
                shell(width - 2 * wall - 0.4, depth - 2 * wall - 0.4, lip, corner_radius);
                translate([0, 0, -eps])
                    shell(width - 2 * wall - 0.4 - 2 * lip,
                          depth - 2 * wall - 0.4 - 2 * lip, lip + 2 * eps, corner_radius);
            }
    }
}

box();
if (with_lid)
    translate([width + 15, 0, 0]) lid();
`;

const GEAR_KNOB = `// Knurled control knob with a D-shaft bore.

/* [Knob] */
knob_diameter = 32;  // [15:80]
knob_height = 14;    // [6:40]
ridges = 24;         // [8:60]
ridge_depth = 1.2;   // [0.4:0.2:3]

/* [Shaft] */
bore_diameter = 6;   // [2:12]
d_flat = true;

/* [Hidden] */
$fn = 96;
eps = 0.01;

module ridge_profile() {
    r = knob_diameter / 2;
    for (i = [0:ridges - 1])
        rotate([0, 0, i * 360 / ridges])
            translate([r, 0])
            circle(d = ridge_depth * 2, $fn = 24);
}

module knob_body() {
    difference() {
        linear_extrude(knob_height, convexity = 4)
            union() {
                circle(d = knob_diameter);
                ridge_profile();
            }
        // chamfer the top rim
        translate([0, 0, knob_height])
            rotate_extrude()
            translate([knob_diameter / 2 + ridge_depth, 0])
            circle(d = 4, $fn = 24);
    }
}

module bore() {
    flat_offset = bore_diameter * 0.35;
    difference() {
        translate([0, 0, -eps])
            cylinder(h = knob_height + 2 * eps, d = bore_diameter);
        if (d_flat)
            translate([flat_offset, -bore_diameter / 2, -2 * eps])
                cube([bore_diameter, bore_diameter, knob_height + 4 * eps]);
    }
}

difference() {
    knob_body();
    bore();
}
`;

const MOUNTING_PLATE = `// 2D mounting plate: laser-cut or CNC outline with a hole pattern.

/* [Plate] */
plate_width = 80;   // [30:200]
plate_height = 50;  // [20:150]
fillet = 5;         // [0:15]

/* [Holes] */
hole_diameter = 4.2;  // [2:0.1:10]
hole_margin = 6;      // [3:20]
center_slot = true;

/* [Hidden] */
$fn = 64;

module outline() {
    offset(r = fillet) offset(r = -fillet)
        square([plate_width, plate_height], center = true);
}

module corner_holes() {
    dx = plate_width / 2 - hole_margin;
    dy = plate_height / 2 - hole_margin;
    for (x = [-dx, dx], y = [-dy, dy])
        translate([x, y]) circle(d = hole_diameter);
}

module slot() {
    hull()
        for (x = [-plate_width / 6, plate_width / 6])
            translate([x, 0]) circle(d = hole_diameter + 1);
}

difference() {
    outline();
    corner_holes();
    if (center_slot) slot();
}
`;

export const BUILT_IN_SAMPLES: readonly BuiltInSample[] = Object.freeze([
  Object.freeze({
    id: "parametric-box",
    name: "Parametric storage box",
    summary: "Explore sections, sliders, a style menu, and an optional lid.",
    path: "parametric_box.scad",
    dimension: "3d",
    source: PARAMETRIC_BOX,
  }),
  Object.freeze({
    id: "gear-knob",
    name: "Gear knob",
    summary: "See modules, loops, math, and a configurable D-shaft bore.",
    path: "gear_knob.scad",
    dimension: "3d",
    source: GEAR_KNOB,
  }),
  Object.freeze({
    id: "mounting-plate",
    name: "Mounting plate",
    summary: "Create a parameterized 2D plate ready for SVG or DXF export.",
    path: "mounting_plate.scad",
    dimension: "2d",
    source: MOUNTING_PLATE,
  }),
]);
