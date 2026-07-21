import { describe, expect, it } from "vitest";

import {
  cameraForAxis,
  cameraToFit,
  toggleProjection,
} from "../../../src/application/viewer/camera";
import { viewerDocument, createViewerState } from "../../../src/application/viewer/viewer-state";

const bounds = { min: [0, 0, 0] as const, max: [10, 20, 30] as const };

describe("viewer camera commands", () => {
  it.each([
    ["top", [5, 10, 81], [0, 1, 0]],
    ["bottom", [5, 10, -51], [0, 1, 0]],
    ["front", [5, -56, 15], [0, 0, 1]],
    ["back", [5, 76, 15], [0, 0, 1]],
    ["left", [-61, 10, 15], [0, 0, 1]],
    ["right", [71, 10, 15], [0, 0, 1]],
  ] as const)("creates a %s axis view centered on the model", (axis, position, up) => {
    const current = viewerDocument(createViewerState(), "doc").camera;
    const camera = cameraForAxis(current, bounds, axis);

    expect(camera.target).toEqual([5, 10, 15]);
    expect(camera.position).toEqual(position);
    expect(camera.up).toEqual(up);
  });

  it("fits while preserving view direction and toggles projection without position loss", () => {
    const current = {
      ...viewerDocument(createViewerState(), "doc").camera,
      position: [10, 10, 10] as const,
      target: [0, 0, 0] as const,
      zoom: 2,
    };
    const fitted = cameraToFit(current, bounds);
    const toggled = toggleProjection(fitted);

    expect(fitted.target).toEqual([5, 10, 15]);
    expect(fitted.zoom).toBe(1);
    expect(toggled).toEqual({ ...fitted, projection: "orthographic" });
  });
});
