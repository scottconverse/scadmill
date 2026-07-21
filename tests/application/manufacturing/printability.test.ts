import { describe, expect, it } from "vitest";

import {
  analyzePrintability,
  printabilityReportLines,
} from "../../../src/application/manufacturing/printability";

type Point = readonly [number, number, number];

function binaryStl(triangles: readonly (readonly [Point, Point, Point])[]): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((vertices, triangle) => {
    vertices.forEach((vertex, vertexIndex) => {
      vertex.forEach((coordinate, axis) => {
        view.setFloat32(84 + triangle * 50 + 12 + vertexIndex * 12 + axis * 4, coordinate, true);
      });
    });
  });
  return bytes;
}

const tetrahedron = binaryStl([
  [[0, 0, 0], [0, 1, 0], [1, 0, 0]],
  [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
]);

describe("analyzePrintability", () => {
  it("reports a closed mesh and its bounds against the configured build volume", () => {
    const report = analyzePrintability(tetrahedron, {
      buildVolumeMm: [220, 220, 250],
      nozzleDiameterMm: 0.4,
    });

    expect(report.manifold).toMatchObject({ status: "pass", boundaryEdges: 0, nonManifoldEdges: 0 });
    expect(report.buildVolume).toMatchObject({ status: "pass", modelSizeMm: [1, 1, 1] });
    expect(report.minimumFeature.status).toBe("pass");
  });

  it("fails a deliberately non-manifold fixture and labels every unrun heuristic", () => {
    const report = analyzePrintability(binaryStl([
      [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
    ]), {
      buildVolumeMm: [220, 220, 250],
      nozzleDiameterMm: 0.4,
    });

    expect(printabilityReportLines(report)).toEqual([
      "Manifold: FAIL (mesh topology check; 3 boundary edges, 0 non-manifold edges)",
      "Build volume: PASS (bounding box 10 × 10 × 0 mm vs configured 220 × 220 × 250 mm)",
      "Minimum feature: NOT CHECKED (no non-adjacent surface samples were available)",
      "Overhangs: NOT CHECKED (no overhang analysis was run)",
    ]);
  });

  it("warns when sampled non-adjacent surfaces are closer than the nozzle width", () => {
    const report = analyzePrintability(binaryStl([
      [[0, 0, 0], [10, 0, 0], [0, 10, 0]],
      [[0, 0, 0.2], [10, 0, 0.2], [0, 10, 0.2]],
    ]), {
      buildVolumeMm: [220, 220, 250],
      nozzleDiameterMm: 0.4,
    });

    expect(report.minimumFeature.status).toBe("warning");
    if (report.minimumFeature.status !== "warning") throw new Error("Expected a warning result.");
    expect(report.minimumFeature.detectedMm).toBeCloseTo(0.2, 6);
    expect(printabilityReportLines(report)[2]).toBe(
      "Minimum feature: WARNING (sampled non-adjacent surface separation 0.2 mm vs configured 0.4 mm nozzle)",
    );
  });

  it("rejects invalid user configuration and malformed mesh bytes", () => {
    expect(() => analyzePrintability(tetrahedron, {
      buildVolumeMm: [0, 220, 250], nozzleDiameterMm: 0.4,
    })).toThrow(/build volume/i);
    expect(() => analyzePrintability(new Uint8Array(84), {
      buildVolumeMm: [220, 220, 250], nozzleDiameterMm: 0.4,
    })).toThrow(/triangles/i);
  });
});
