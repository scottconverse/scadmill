import { describe, expect, it } from "vitest";
import {
  fitSvgViewport,
  modelPointAtScreen,
  zoomSvgViewportAt,
} from "../../../src/application/viewer/svg-viewport";

describe("2D SVG viewport", () => {
  it("fits a drawing with padding and reports millimeters per pixel", () => {
    const viewport = fitSvgViewport(
      { min: [0, 0], max: [30, 20] },
      { width: 600, height: 400 },
      20,
    );

    expect(viewport.center).toEqual([15, 10]);
    expect(viewport.mmPerPixel).toBeCloseTo(Math.max(30 / 560, 20 / 360), 12);
  });

  it("keeps the model point under the cursor fixed while zooming", () => {
    const initial = { center: [15, 10] as [number, number], mmPerPixel: 0.1 };
    const size = { width: 600, height: 400 };
    const cursor = { x: 430, y: 115 };
    const before = modelPointAtScreen(initial, size, cursor);
    const zoomed = zoomSvgViewportAt(initial, size, cursor, 0.5);
    const after = modelPointAtScreen(zoomed, size, cursor);

    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
    expect(zoomed.mmPerPixel).toBe(0.05);
  });

  it("rejects empty viewport sizes and unsafe zoom factors", () => {
    expect(() =>
      fitSvgViewport({ min: [0, 0], max: [1, 1] }, { width: 0, height: 100 }),
    ).toThrow(/positive/i);
    expect(() =>
      zoomSvgViewportAt(
        { center: [0, 0], mmPerPixel: 1 },
        { width: 100, height: 100 },
        { x: 50, y: 50 },
        0,
      ),
    ).toThrow(/zoom/i);
  });
});
