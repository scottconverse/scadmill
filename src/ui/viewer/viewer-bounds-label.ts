import type { RenderSuccess3D } from "../../application/engine/contracts";
import { messages } from "../../messages/en";

export function boundsLabel(result: RenderSuccess3D): string | null {
  const bounds = result.stats.boundingBox;
  if (!bounds) return null;
  const size = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]);
  return messages.dimensionsMillimeters(size.map((value) => Number(value.toFixed(3))));
}
