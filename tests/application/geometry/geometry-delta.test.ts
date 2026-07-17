import { describe, expect, it } from "vitest";

import type {
  RenderSuccess2D,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
import { geometryDelta } from "../../../src/application/geometry/geometry-delta";

const drawing = (svg: string, min: [number, number], max: [number, number]): RenderSuccess2D => ({
  kind: "2d",
  svg,
  boundingBox: { min, max },
  diagnostics: [],
  rawLog: "",
});

const solid: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "",
};

describe("geometry delta", () => {
  it("reports only comparable two-dimensional bounds", () => {
    expect(geometryDelta(
      drawing("<svg/>", [0, 0], [10, 20]),
      drawing("<svg><path/></svg>", [2, -1], [14, 23]),
      false,
    )).toEqual({
      kind: "changed",
      dimensions: 2,
      boundingBox: {
        min: [2, -1],
        max: [4, 3],
        size: [2, 4],
      },
    });
  });

  it("does not invent metrics across a two-dimensional to three-dimensional transition", () => {
    expect(geometryDelta(drawing("<svg/>", [0, 0], [10, 20]), solid, false)).toEqual({
      kind: "changed",
      dimensions: "incomparable",
    });
  });

  it("omits unavailable three-dimensional engine statistics instead of treating them as zero", () => {
    expect(geometryDelta(solid, {
      ...solid,
      mesh: { ...solid.mesh, bytes: new Uint8Array(85) },
    }, false)).toEqual({
      kind: "changed",
      dimensions: 3,
    });
  });
});
