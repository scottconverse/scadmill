import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BUILT_IN_SAMPLES } from "../../src/application/welcome/built-in-samples";

const REQUIRED_VERSION = "2026.06.12";
const REQUIRED_EXECUTABLE_SHA256 =
  "DE9A0C732C23C3FEB0B49CF938777AA0AEE3E206DB9E98571672CACC4816C524";

interface ParityCase {
  readonly id: string;
  readonly entryFile: string;
  readonly source: string;
  readonly format: "stl-binary" | "svg";
}

interface BrowserExportResult {
  readonly ok: boolean;
  readonly bytes?: number[];
  readonly rawLog: string;
  readonly version: string | null;
}

declare global {
  interface Window {
    runAc4ParityExport(request: {
      readonly entryFile: string;
      readonly source: string;
      readonly format: "stl-binary" | "svg";
    }): Promise<BrowserExportResult>;
  }
}

const CSG = `// CSG.scad - Basic example of CSG usage

translate([-24,0,0]) {
    union() {
        cube(15, center=true);
        sphere(10);
    }
}

intersection() {
    cube(15, center=true);
    sphere(10);
}

translate([24,0,0]) {
    difference() {
        cube(15, center=true);
        sphere(10);
    }
}

echo(version=version());
// Written by Marius Kintel <marius@kintel.net>
//
// To the extent possible under law, the author(s) have dedicated all
// copyright and related and neighboring rights to this software to the
// public domain worldwide. This software is distributed without any
// warranty.
//
// You should have received a copy of the CC0 Public Domain
// Dedication along with this software.
// If not, see <http://creativecommons.org/publicdomain/zero/1.0/>.
`;

const LINEAR_EXTRUDE = `echo(version=version());

// simple 2D -> 3D extrusion of a rectangle
color("red")
    translate([0, -30, 0])
        linear_extrude(height = 20)
            square([20, 10], center = true);

// using the scale parameter a frustum can be constructed
color("green")
    translate([-30, 0, 0])
        linear_extrude(height = 20, scale = 0.2)
            square([20, 10], center = true);

// with twist the extruded shape will rotate around the Z axis
color("cyan")
    translate([30, 0, 0])
        linear_extrude(height = 20, twist = 90)
            square([20, 10], center = true);

// combining both relatively complex shapes can be created
color("gray")
    translate([0, 30, 0])
        linear_extrude(height = 40, twist = -360, scale = 0, center = true, $fs=1, $fa=1)
            square([20, 10], center = true);

// Written in 2015 by Torsten Paul <Torsten.Paul@gmx.de>
//
// To the extent possible under law, the author(s) have dedicated all
// copyright and related and neighboring rights to this software to the
// public domain worldwide. This software is distributed without any
// warranty.
//
// You should have received a copy of the CC0 Public Domain
// Dedication along with this software.
// If not, see <http://creativecommons.org/publicdomain/zero/1.0/>.
`;

const OFFSET = `// offset.scad - Example for offset() usage in OpenSCAD

$fn = 40;

foot_height = 20;

echo(version=version());

module outline(wall = 1) {
  difference() {
    offset(wall / 2) children();
    offset(-wall / 2) children();
  }
}

// offsetting with a positive value allows to create rounded corners easily
linear_extrude(height = foot_height, scale = 0.5) {
  offset(10) {
    square(50, center = true);
  }
}

translate([0, 0, foot_height]) {
  linear_extrude(height = 20) {
    outline(wall = 2) circle(15);
  }
}

%cylinder(r = 14, h = 100);
%translate([0, 0, 100]) sphere(r = 30);

// Written in 2014 by Torsten Paul <Torsten.Paul@gmx.de>
//
// To the extent possible under law, the author(s) have dedicated all
// copyright and related and neighboring rights to this software to the
// public domain worldwide. This software is distributed without any
// warranty.
//
// You should have received a copy of the CC0 Public Domain
// Dedication along with this software.
// If not, see <http://creativecommons.org/publicdomain/zero/1.0/>.
`;

const appendixCases = BUILT_IN_SAMPLES.map((sample) => ({
  id: `appendix-${sample.id}`,
  entryFile: sample.path,
  source: sample.source,
  format: sample.dimension === "2d" ? "svg" as const : "stl-binary" as const,
}));

const cases: readonly ParityCase[] = [
  ...appendixCases,
  { id: "official-csg", entryFile: "CSG.scad", source: CSG, format: "stl-binary" },
  {
    id: "official-linear-extrude",
    entryFile: "linear_extrude.scad",
    source: LINEAR_EXTRUDE,
    format: "stl-binary",
  },
  { id: "official-offset", entryFile: "offset.scad", source: OFFSET, format: "stl-binary" },
];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function firstDifference(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : sharedLength;
}

function byteAt(bytes: Uint8Array, index: number): string {
  if (index < 0) return "none";
  return index < bytes.length ? `0x${bytes[index].toString(16).padStart(2, "0")}` : "EOF";
}

function nativeExport(executable: string, parityCase: ParityCase): Uint8Array {
  const root = mkdtempSync(join(tmpdir(), `scadmill-ac4-${parityCase.id}-`));
  try {
    const input = join(root, parityCase.entryFile);
    const output = join(root, parityCase.format === "svg" ? "model.svg" : "model.stl");
    writeFileSync(input, parityCase.source, "utf8");
    const process = spawnSync(
      executable,
      [
        "--export-format",
        parityCase.format === "svg" ? "svg" : "binstl",
        "-o",
        output,
        parityCase.entryFile,
      ],
      { cwd: root, encoding: "utf8", timeout: 120_000 },
    );
    expect(
      process.status,
      `native ${parityCase.id} failed\nstdout:\n${process.stdout}\nstderr:\n${process.stderr}`,
    ).toBe(0);
    return readFileSync(output);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("AC-4.a preserves exact native/WASM bytes for Appendix F and official examples", async ({
  page,
}) => {
  const executable = process.env.SCADMILL_AC4_OPENSCAD;
  expect(executable, "SCADMILL_AC4_OPENSCAD must identify the pinned native executable").toBeTruthy();
  if (!executable) return;

  const executableBytes = readFileSync(executable);
  expect(sha256(executableBytes)).toBe(REQUIRED_EXECUTABLE_SHA256);
  const version = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 30_000 });
  expect(`${version.stdout}${version.stderr}`).toContain(`OpenSCAD version ${REQUIRED_VERSION}`);

  await page.goto("/tests/parity/fixtures/ac4-parity.html");

  for (const parityCase of cases) {
    const nativeBytes = nativeExport(executable, parityCase);
    const browser = await page.evaluate(
      (request) => window.runAc4ParityExport(request),
      {
        entryFile: parityCase.entryFile,
        source: parityCase.source,
        format: parityCase.format,
      },
    );
    expect(browser.version, `${parityCase.id} WASM version`).toBe(REQUIRED_VERSION);
    expect(browser.ok, `${parityCase.id} WASM export failed:\n${browser.rawLog}`).toBe(true);
    expect(browser.bytes, `${parityCase.id} WASM export returned no bytes`).toBeDefined();
    const wasmBytes = Uint8Array.from(browser.bytes ?? []);
    const firstDiff = firstDifference(nativeBytes, wasmBytes);
    expect(
      firstDiff,
      [
        `${parityCase.id} exact ${parityCase.format} parity mismatch`,
        `native length=${nativeBytes.length} sha256=${sha256(nativeBytes)}`,
        `wasm length=${wasmBytes.length} sha256=${sha256(wasmBytes)}`,
        `first-diff=${firstDiff} native=${byteAt(nativeBytes, firstDiff)} wasm=${byteAt(wasmBytes, firstDiff)}`,
      ].join("\n"),
    ).toBe(-1);
  }
});
