import { describe, expect, it } from "vitest";

import type { ParamValue } from "../../../src/application/engine/contracts";
import {
  createExportRequest,
  defaultExportFormat,
  summarizeExportArtifact,
} from "../../../src/application/files/export-flow";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";

function cubeStl(): Uint8Array {
  const bytes = new Uint8Array(84 + 12 * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 12, true);
  const triangles = [
    [[0, 0, 0], [10, 0, 0], [10, 10, 0]], [[0, 0, 0], [10, 10, 0], [0, 10, 0]],
    [[0, 0, 10], [10, 10, 10], [10, 0, 10]], [[0, 0, 10], [0, 10, 10], [10, 10, 10]],
    [[0, 0, 0], [10, 0, 10], [10, 0, 0]], [[0, 0, 0], [0, 0, 10], [10, 0, 10]],
    [[0, 10, 0], [10, 10, 0], [10, 10, 10]], [[0, 10, 0], [10, 10, 10], [0, 10, 10]],
    [[0, 0, 0], [0, 10, 0], [0, 10, 10]], [[0, 0, 0], [0, 10, 10], [0, 0, 10]],
    [[10, 0, 0], [10, 0, 10], [10, 10, 10]], [[10, 0, 0], [10, 10, 10], [10, 10, 0]],
  ];
  triangles.flat(2).forEach((coordinate, index) => {
    view.setFloat32(96 + Math.floor(index / 9) * 14 + index * 4, coordinate, true);
  });
  return bytes;
}

describe("export flow", () => {
  it("defaults meshes to 3MF and constructs only export-grade requests", () => {
    expect(defaultExportFormat("3d")).toBe("3mf");
    expect(defaultExportFormat("2d")).toBe("svg");
    const snapshot = createProjectSnapshot("project", new Map<string, ProjectFileContent>([
      ["main.scad", "import(\"asset.stl\");"],
      ["asset.stl", new Uint8Array([1, 2, 3])],
    ]));
    const parameters: Record<string, ParamValue> = { size: 12 };
    const request = createExportRequest({
      snapshot,
      entryFile: "main.scad",
      format: "3mf",
      parameters,
      timeoutMs: 600_000,
    });

    expect(request).toEqual({
      entryFile: "main.scad",
      files: snapshot.files,
      parameters,
      format: "3mf",
      timeoutMs: 600_000,
    });
    expect("quality" in request).toBe(false);
    expect("previewFacetLimit" in request).toBe(false);
  });

  it("reports exact binary-STL triangle, bounds, and file-size summary", () => {
    expect(summarizeExportArtifact("stl-binary", cubeStl())).toEqual({
      fileSizeBytes: 684,
      triangleCount: 12,
      boundingBox: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
    });
    expect(summarizeExportArtifact("3mf", new Uint8Array([1, 2, 3]))).toEqual({
      fileSizeBytes: 3,
    });
  });
});
