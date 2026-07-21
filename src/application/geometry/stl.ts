export interface AxisAlignedBounds3D {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  size: readonly [number, number, number];
}

export interface ParsedBinaryStl {
  triangleCount: number;
  positions: Float32Array;
  normals: Float32Array;
  bounds: AxisAlignedBounds3D;
}

const HEADER_BYTES = 84;
const TRIANGLE_BYTES = 50;
const NORMAL_BYTES = 12;
const COORDINATES_PER_TRIANGLE = 9;

export function closedMeshVolumeMm3(positions: Float32Array): number {
  if (positions.length === 0 || positions.length % COORDINATES_PER_TRIANGLE !== 0) {
    throw new Error("STL positions must contain one or more complete triangles.");
  }
  const referenceX = positions[0];
  const referenceY = positions[1];
  const referenceZ = positions[2];
  let signedSixfoldVolume = 0;
  let compensation = 0;
  for (let offset = 0; offset < positions.length; offset += COORDINATES_PER_TRIANGLE) {
    const ax = positions[offset] - referenceX;
    const ay = positions[offset + 1] - referenceY;
    const az = positions[offset + 2] - referenceZ;
    const bx = positions[offset + 3] - referenceX;
    const by = positions[offset + 4] - referenceY;
    const bz = positions[offset + 5] - referenceZ;
    const cx = positions[offset + 6] - referenceX;
    const cy = positions[offset + 7] - referenceY;
    const cz = positions[offset + 8] - referenceZ;
    const term = ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx);
    if (!Number.isFinite(term)) throw new Error("STL positions contain a non-finite coordinate.");
    const corrected = term - compensation;
    const next = signedSixfoldVolume + corrected;
    compensation = (next - signedSixfoldVolume) - corrected;
    signedSixfoldVolume = next;
  }
  return Math.abs(signedSixfoldVolume) / 6;
}

export function parseBinaryStl(bytes: Uint8Array): ParsedBinaryStl {
  if (bytes.byteLength < HEADER_BYTES) {
    throw new Error("Binary STL is shorter than its 84-byte header.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  if (triangleCount === 0) {
    throw new Error("Binary STL contains no triangles.");
  }

  const expectedBytes = HEADER_BYTES + triangleCount * TRIANGLE_BYTES;
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `Binary STL length is ${bytes.byteLength} bytes; ${expectedBytes} bytes are required for ${triangleCount} triangles.`,
    );
  }

  const positions = new Float32Array(triangleCount * COORDINATES_PER_TRIANGLE);
  const normals = new Float32Array(triangleCount * COORDINATES_PER_TRIANGLE);
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const vertexBytes = HEADER_BYTES + triangle * TRIANGLE_BYTES + NORMAL_BYTES;
    const positionOffset = triangle * COORDINATES_PER_TRIANGLE;
    for (let coordinate = 0; coordinate < COORDINATES_PER_TRIANGLE; coordinate += 1) {
      const value = view.getFloat32(vertexBytes + coordinate * 4, true);
      if (!Number.isFinite(value)) {
        throw new Error(`Binary STL triangle ${triangle + 1} contains a non-finite coordinate.`);
      }

      positions[positionOffset + coordinate] = value;
      const axis = coordinate % 3;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
    let normalX = view.getFloat32(vertexBytes - NORMAL_BYTES, true);
    let normalY = view.getFloat32(vertexBytes - NORMAL_BYTES + 4, true);
    let normalZ = view.getFloat32(vertexBytes - NORMAL_BYTES + 8, true);
    let magnitude = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      const ax = positions[positionOffset];
      const ay = positions[positionOffset + 1];
      const az = positions[positionOffset + 2];
      const abx = positions[positionOffset + 3] - ax;
      const aby = positions[positionOffset + 4] - ay;
      const abz = positions[positionOffset + 5] - az;
      const acx = positions[positionOffset + 6] - ax;
      const acy = positions[positionOffset + 7] - ay;
      const acz = positions[positionOffset + 8] - az;
      normalX = aby * acz - abz * acy;
      normalY = abz * acx - abx * acz;
      normalZ = abx * acy - aby * acx;
      magnitude = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
    }
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      normalX = 0;
      normalY = 0;
      normalZ = 1;
      magnitude = 1;
    }
    const inverseMagnitude = 1 / magnitude;
    normalX *= inverseMagnitude;
    normalY *= inverseMagnitude;
    normalZ *= inverseMagnitude;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const normalOffset = positionOffset + vertex * 3;
      normals[normalOffset] = normalX;
      normals[normalOffset + 1] = normalY;
      normals[normalOffset + 2] = normalZ;
    }
  }

  return {
    triangleCount,
    positions,
    normals,
    bounds: {
      min,
      max,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
  };
}
