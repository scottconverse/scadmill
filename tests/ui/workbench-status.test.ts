import { describe, expect, it } from "vitest";

import type { RenderState } from "../../src/application/runtime/workbench-runtime";
import { messages } from "../../src/messages/en";
import {
  geometryDeltaStatusLabel,
  renderStatusLabel,
} from "../../src/ui/workbench-status";

describe("workbench render status", () => {
  it("reports a completed cancellation as cancelled rather than failed", () => {
    const render: RenderState = {
      status: "failure",
      entryFile: "main.scad",
      result: {
        kind: "failure",
        reason: "cancelled",
        diagnostics: [],
        rawLog: "cancelled",
      },
    };

    expect(renderStatusLabel(render, false, "main.scad")).toBe(messages.renderCancelledStatus);
  });

  it("reports every available signed three-dimensional geometry delta", () => {
    expect(geometryDeltaStatusLabel({
      kind: "changed",
      dimensions: 3,
      volumeMm3: 250,
      triangles: 4,
      boundingBox: {
        min: [2, -1, 0],
        max: [4, 2, 5],
        size: [2, 3, 5],
      },
    })).toBe(
      "Geometry changed; Δvolume +250 mm³; Δbounds min +2/-1/0 mm, max +4/+2/+5 mm, size +2/+3/+5 mm; Δtriangles +4",
    );
  });

  it("does not round nonzero sub-micron changes to zero", () => {
    const label = geometryDeltaStatusLabel({
      kind: "changed",
      dimensions: 3,
      volumeMm3: 0.0004,
      triangles: 0,
      boundingBox: {
        min: [-0.0004, 0.0004, 0],
        max: [0, 0, 0],
        size: [0.0004, -0.0004, 0],
      },
    });

    expect(label).toContain("Δvolume +<0.001 mm³");
    expect(label).toContain("min -<0.001/+<0.001/0 mm");
  });

  it("labels non-applicable, unavailable, and cross-dimension metrics honestly", () => {
    expect(geometryDeltaStatusLabel({
      kind: "changed",
      dimensions: 2,
      boundingBox: { min: [1, 2], max: [1, 2], size: [0, 0] },
    })).toContain("Δvolume not applicable");
    expect(geometryDeltaStatusLabel({ kind: "changed", dimensions: 3 })).toBe(
      "Geometry changed; Δvolume unavailable; Δbounds unavailable; Δtriangles unavailable",
    );
    expect(geometryDeltaStatusLabel({
      kind: "changed",
      dimensions: "incomparable",
    })).toBe("Geometry changed; metrics are not comparable across 2D and 3D");
  });
});
