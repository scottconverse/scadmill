import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
} from "three";

import type { ParsedModelMesh } from "../../application/geometry/model-mesh";
import type { ViewerModelMaterial } from "./model-viewer-runtime";

export function createModelMesh(
  parsed: ParsedModelMesh,
): Mesh<BufferGeometry, ViewerModelMaterial> {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(parsed.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(parsed.normals, 3));
  if (parsed.colors) geometry.setAttribute("color", new BufferAttribute(parsed.colors, 3));
  const parts = parsed.parts ?? [];
  const material = parts.length > 0
    ? parts.map((part, index) => {
        geometry.addGroup(part.triangleOffset * 3, part.triangleCount * 3, index);
        return new MeshStandardMaterial({
          roughness: 0.72,
          metalness: 0.08,
          vertexColors: parsed.colors !== undefined,
        });
      })
    : new MeshStandardMaterial({
        roughness: 0.72,
        metalness: 0.08,
        vertexColors: parsed.colors !== undefined,
      });
  return new Mesh(geometry, material);
}
