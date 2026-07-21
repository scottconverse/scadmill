import type { RenderSuccess2D, RenderSuccess3D } from "../engine/contracts";

type SuccessfulGeometry = RenderSuccess2D | RenderSuccess3D;

export interface SignedBoundsDelta {
  readonly min: readonly number[];
  readonly max: readonly number[];
  readonly size: readonly number[];
}

export type GeometryDelta =
  | { readonly kind: "baseline" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "changed";
      readonly dimensions: 2 | 3 | "incomparable";
      readonly volumeMm3?: number;
      readonly triangles?: number;
      readonly boundingBox?: SignedBoundsDelta;
    };

function boundsOf(result: SuccessfulGeometry) {
  return result.kind === "3d" ? result.stats.boundingBox : result.boundingBox;
}

function subtract(left: readonly number[], right: readonly number[]): readonly number[] {
  return left.map((value, axis) => value - right[axis]);
}

function boundsDelta(
  previous: SuccessfulGeometry,
  current: SuccessfulGeometry,
): SignedBoundsDelta | undefined {
  if (previous.kind !== current.kind) return undefined;
  const previousBounds = boundsOf(previous);
  const currentBounds = boundsOf(current);
  if (!previousBounds || !currentBounds) return undefined;
  const previousSize = subtract(previousBounds.max, previousBounds.min);
  const currentSize = subtract(currentBounds.max, currentBounds.min);
  return {
    min: subtract(currentBounds.min, previousBounds.min),
    max: subtract(currentBounds.max, previousBounds.max),
    size: subtract(currentSize, previousSize),
  };
}

export function geometryDelta(
  previous: SuccessfulGeometry | undefined,
  current: SuccessfulGeometry,
  unchanged: boolean | undefined,
): GeometryDelta {
  if (!previous) return { kind: "baseline" };
  if (unchanged === undefined) return { kind: "unavailable" };
  if (unchanged) return { kind: "unchanged" };
  const comparable3d = previous.kind === "3d" && current.kind === "3d";
  const boundingBox = boundsDelta(previous, current);
  return {
    kind: "changed",
    dimensions: previous.kind !== current.kind ? "incomparable" : current.kind === "3d" ? 3 : 2,
    ...(comparable3d
      && previous.stats.volumeMm3 !== undefined
      && current.stats.volumeMm3 !== undefined
      ? { volumeMm3: current.stats.volumeMm3 - previous.stats.volumeMm3 }
      : {}),
    ...(comparable3d
      && previous.stats.triangles !== undefined
      && current.stats.triangles !== undefined
      ? { triangles: current.stats.triangles - previous.stats.triangles }
      : {}),
    ...(boundingBox ? { boundingBox } : {}),
  };
}
