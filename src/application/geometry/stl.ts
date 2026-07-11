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
    for (let coordinate = 0; coordinate < COORDINATES_PER_TRIANGLE; coordinate += 1) {
      const value = view.getFloat32(vertexBytes + coordinate * 4, true);
      if (!Number.isFinite(value)) {
        throw new Error(`Binary STL triangle ${triangle + 1} contains a non-finite coordinate.`);
      }

      positions[triangle * COORDINATES_PER_TRIANGLE + coordinate] = value;
      const axis = coordinate % 3;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
    const positionOffset = triangle * COORDINATES_PER_TRIANGLE;
    let normal: [number, number, number] = [
      view.getFloat32(vertexBytes - NORMAL_BYTES, true),
      view.getFloat32(vertexBytes - NORMAL_BYTES + 4, true),
      view.getFloat32(vertexBytes - NORMAL_BYTES + 8, true),
    ];
    let magnitude = Math.hypot(...normal);
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
      normal = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
      magnitude = Math.hypot(...normal);
    }
    if (!Number.isFinite(magnitude) || magnitude === 0) {
      normal = [0, 0, 1];
      magnitude = 1;
    }
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const normalOffset = positionOffset + vertex * 3;
      normals[normalOffset] = normal[0] / magnitude;
      normals[normalOffset + 1] = normal[1] / magnitude;
      normals[normalOffset + 2] = normal[2] / magnitude;
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
