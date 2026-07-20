import type { RenderSuccess3D } from "../../application/engine/contracts";
import { isSha256GeometryIdentity } from "../../application/geometry/geometry-identity";
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

function geometryKey(result: RenderSuccess3D): string | undefined {
  return isSha256GeometryIdentity(result.mesh.geometryIdentity)
    ? result.mesh.geometryIdentity
    : undefined;
}

export class ParsedMeshReuse {
  private key: string | undefined;
  private parser: ModelMeshParser | undefined;

  matches(result: RenderSuccess3D, parser: ModelMeshParser): boolean {
    const candidate = geometryKey(result);
    return candidate !== undefined && this.key === candidate && this.parser === parser;
  }

  accept(result: RenderSuccess3D, parser: ModelMeshParser): void {
    this.key = geometryKey(result);
    this.parser = parser;
  }
}

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
