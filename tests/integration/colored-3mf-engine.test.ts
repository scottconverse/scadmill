import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseThreeMf } from "../../src/application/geometry/three-mf";

const engine = process.env.SCADMILL_OPENSCAD;

function uniqueVertexCount(
  positions: Float32Array,
  triangleOffset: number,
  triangleCount: number,
): number {
  const vertices = new Set<string>();
  const start = triangleOffset * 9;
  const end = start + triangleCount * 9;
  for (let offset = start; offset < end; offset += 3) {
    vertices.add(`${positions[offset]},${positions[offset + 1]},${positions[offset + 2]}`);
  }
  return vertices.size;
}

describe.skipIf(!engine)("pinned OpenSCAD colored 3MF evidence", () => {
  it("exports two correctly colored objects and round-trips both cube meshes", () => {
    const root = mkdtempSync(join(tmpdir(), "scadmill-colored-3mf-"));
    try {
      const source = join(root, "main.scad");
      const output = join(root, "main.3mf");
      writeFileSync(source, 'color("red") cube(10); translate([20, 0, 0]) color("blue") cube(10);');
      const process = spawnSync(engine as string, [
        "--export-format", "3mf",
        "--backend", "Manifold",
        "--enable", "lazy-union",
        "-O", "export-3mf/color-mode=model",
        "-O", "export-3mf/material-type=color",
        "-o", output,
        source,
      ], { encoding: "utf8", timeout: 60_000 });
      expect(
        process.status,
        `OpenSCAD failed\nstdout:\n${process.stdout}\nstderr:\n${process.stderr}`,
      ).toBe(0);

      const archive = readFileSync(output);
      const parsed = parseThreeMf(archive);
      const parts = parsed.parts ?? [];
      expect(parts.map(({ color }) => color)).toEqual(["#FF0000", "#0000FF"]);
      expect(parts).toHaveLength(2);
      expect(parts.map((part) =>
        uniqueVertexCount(parsed.positions, part.triangleOffset, part.triangleCount)
      )).toEqual([8, 8]);

      const xml = strFromU8(unzipSync(archive)["3D/3dmodel.model"] ?? new Uint8Array());
      expect(xml).toMatch(/<(?:\w+:)?colorgroup\b/iu);
      expect(xml).not.toMatch(/<basematerials\b/iu);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
