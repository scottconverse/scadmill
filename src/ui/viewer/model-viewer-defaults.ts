import type { ParsedBinaryStl } from "../../application/geometry/stl";
import { parseBinaryStlOffThread } from "../../application/geometry/stl-parser-worker-client";
import {
  createDefaultViewerCamera,
  type ViewerFurnitureState,
} from "../../application/viewer/viewer-state";

export type ModelMeshParser = (
  bytes: Uint8Array,
  signal: AbortSignal,
) => Promise<ParsedBinaryStl>;

export const DEFAULT_MESH_PARSER: ModelMeshParser = (bytes, signal) =>
  parseBinaryStlOffThread(bytes, undefined, signal);
export const DEFAULT_CAMERA = createDefaultViewerCamera();
export const DEFAULT_FURNITURE: ViewerFurnitureState = {
  grid: true,
  axes: true,
  edges: false,
  shadow: false,
};
export const DEFAULT_MOUSE_MAPPING = { orbit: "left", pan: "right" } as const;
