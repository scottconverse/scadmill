import { describe, expect, it } from "vitest";
import {
  boundingBoxDimensions,
  pointDistance,
} from "../../../src/application/viewer/measurements";

describe("viewer measurement geometry", () => {
  it("measures opposite corners of a 10 mm cube within AC-2.c tolerance", () => {
    const distance = pointDistance([0, 0, 0], [10, 10, 10]);
    expect(distance).toBeCloseTo(Math.sqrt(300), 12);
    expect(Math.abs(distance - Math.sqrt(300)) / Math.sqrt(300)).toBeLessThanOrEqual(0.001);
  });

  it("derives ordered bounding-box dimensions", () => {
    expect(
      boundingBoxDimensions({ min: [-5, 2, 10], max: [5, 12, 30] }),
    ).toEqual([10, 10, 20]);
  });

  it("rejects non-finite points and inverted bounds", () => {
    expect(() => pointDistance([0, 0, 0], [Number.NaN, 1, 2])).toThrow(/finite/i);
    expect(() =>
      boundingBoxDimensions({ min: [1, 0, 0], max: [0, 1, 1] }),
    ).toThrow(/ordered/i);
  });
});
