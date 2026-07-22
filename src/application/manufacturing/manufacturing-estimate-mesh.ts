import type { MeshFormat } from "../engine/contracts";
import type { ParsedModelMesh } from "../geometry/model-mesh";
import { parseBinaryStl } from "../geometry/stl";
import { parseThreeMf } from "../geometry/three-mf";

const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;
const COORDINATES_PER_TRIANGLE = 9;

function binaryStl(mesh: ParsedModelMesh): Uint8Array {
  const length = HEADER_BYTES + mesh.triangleCount * TRIANGLE_BYTES;
  if (!Number.isSafeInteger(length)) throw new Error("The estimate mesh is too large.");
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, mesh.triangleCount, true);
  for (let triangle = 0; triangle < mesh.triangleCount; triangle += 1) {
    const sourceOffset = triangle * COORDINATES_PER_TRIANGLE;
    const targetOffset = HEADER_BYTES + triangle * TRIANGLE_BYTES;
    for (let axis = 0; axis < 3; axis += 1) {
      view.setFloat32(targetOffset + axis * 4, mesh.normals[sourceOffset + axis], true);
    }
    for (let coordinate = 0; coordinate < COORDINATES_PER_TRIANGLE; coordinate += 1) {
      view.setFloat32(
        targetOffset + 12 + coordinate * 4,
        mesh.positions[sourceOffset + coordinate],
        true,
      );
    }
  }
  return bytes;
}

export function manufacturingEstimateStl(
  bytes: Uint8Array,
  format: MeshFormat,
): Uint8Array {
  if (format === "stl-binary") {
    parseBinaryStl(bytes);
    return bytes.slice();
  }
  if (format === "3mf") return binaryStl(parseThreeMf(bytes));
  throw new Error("Manufacturing estimates require binary STL or 3MF geometry.");
}
