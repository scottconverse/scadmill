export type Point3 = readonly [number, number, number];

export interface Bounds3 {
  readonly min: Point3;
  readonly max: Point3;
}

function assertFinitePoint(point: Point3, label: string): void {
  if (!point.every(Number.isFinite)) throw new Error(`${label} coordinates must be finite.`);
}

export function pointDistance(start: Point3, end: Point3): number {
  assertFinitePoint(start, "Start point");
  assertFinitePoint(end, "End point");
  return Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
}

export function boundingBoxDimensions(bounds: Bounds3): [number, number, number] {
  assertFinitePoint(bounds.min, "Minimum bound");
  assertFinitePoint(bounds.max, "Maximum bound");
  if (bounds.min.some((minimum, axis) => minimum > bounds.max[axis])) {
    throw new Error("Bounding-box extents must be ordered.");
  }
  return bounds.max.map((maximum, axis) => maximum - bounds.min[axis]) as [
    number,
    number,
    number,
  ];
}
