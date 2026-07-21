import { boundingBoxDimensions, type Bounds3, type Point3 } from "./measurements";
import type { ViewerCameraState } from "./viewer-state";

export type AxisView = "top" | "bottom" | "front" | "back" | "left" | "right";

function center(bounds: Bounds3): [number, number, number] {
  boundingBoxDimensions(bounds);
  return bounds.min.map(
    (minimum, axis) => (minimum + bounds.max[axis]) / 2,
  ) as [number, number, number];
}

function fitDistance(bounds: Bounds3): number {
  return Math.max(...boundingBoxDimensions(bounds)) * 2.2 || 20;
}

const AXIS_DIRECTIONS: Readonly<Record<AxisView, Point3>> = {
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

export function cameraForAxis(
  current: ViewerCameraState,
  bounds: Bounds3,
  axis: AxisView,
): ViewerCameraState {
  const target = center(bounds);
  const distance = fitDistance(bounds);
  const direction = AXIS_DIRECTIONS[axis];
  return {
    ...current,
    target,
    position: [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ],
    up: axis === "top" || axis === "bottom" ? [0, 1, 0] : [0, 0, 1],
    zoom: 1,
  };
}

export function cameraToFit(current: ViewerCameraState, bounds: Bounds3): ViewerCameraState {
  const target = center(bounds);
  const rawDirection = current.position.map(
    (value, axis) => value - current.target[axis],
  ) as [number, number, number];
  const magnitude = Math.hypot(...rawDirection);
  const direction: Point3 = magnitude > 0
    ? rawDirection.map((value) => value / magnitude) as [number, number, number]
    : [1, 0.75, 1];
  const distance = fitDistance(bounds);
  return {
    ...current,
    target,
    position: [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ],
    zoom: 1,
  };
}

export function toggleProjection(current: ViewerCameraState): ViewerCameraState {
  return {
    ...current,
    projection: current.projection === "perspective" ? "orthographic" : "perspective",
  };
}
