import { describe, expect, it } from "vitest";

import { closedMeshVolumeMm3, parseBinaryStl } from "../../../src/application/geometry/stl";

function binaryStl(vertices: ReadonlyArray<readonly [number, number, number]>): Uint8Array {
  if (vertices.length % 3 !== 0) {
    throw new Error("The fixture requires exactly three vertices per triangle.");
  }

  const triangleCount = vertices.length / 3;
  const bytes = new Uint8Array(84 + triangleCount * 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, triangleCount, true);

  vertices.forEach((vertex, index) => {
    const triangle = Math.floor(index / 3);
    const vertexInTriangle = index % 3;
    const offset = 84 + triangle * 50 + 12 + vertexInTriangle * 12;
    vertex.forEach((coordinate, axis) => {
      view.setFloat32(offset + axis * 4, coordinate, true);
    });
  });

  return bytes;
}

function setFacetNormal(bytes: Uint8Array, normal: readonly [number, number, number]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  normal.forEach((coordinate, axis) => {
    view.setFloat32(84 + axis * 4, coordinate, true);
  });
}

describe("parseBinaryStl", () => {
  it("derives translation-invariant enclosed volume from a closed tetrahedron", () => {
    const origin: readonly [number, number, number] = [10, 20, 30];
    const point = (x: number, y: number, z: number): readonly [number, number, number] => (
      [origin[0] + x, origin[1] + y, origin[2] + z]
    );
    const v0 = point(0, 0, 0);
    const v1 = point(1, 0, 0);
    const v2 = point(0, 1, 0);
    const v3 = point(0, 0, 1);
    const parsed = parseBinaryStl(binaryStl([
      v0, v2, v1,
      v0, v1, v3,
      v0, v3, v2,
      v1, v2, v3,
    ]));

    expect(closedMeshVolumeMm3(parsed.positions)).toBeCloseTo(1 / 6, 12);
  });

  it("rejects incomplete or non-finite volume position buffers", () => {
    expect(() => closedMeshVolumeMm3(new Float32Array())).toThrow("complete triangles");
    expect(() => closedMeshVolumeMm3(new Float32Array(8))).toThrow("complete triangles");
    const positions = new Float32Array(9);
    positions[8] = Number.NaN;
    expect(() => closedMeshVolumeMm3(positions)).toThrow("non-finite");
  });

  it("derives triangle positions and bounds from binary STL vertices", () => {
    const result = parseBinaryStl(
      binaryStl([
        [-5, 2, -1],
        [5, 2, -1],
        [5, 22, 29],
      ]),
    );

    expect(result.triangleCount).toBe(1);
    expect(Array.from(result.positions)).toEqual([-5, 2, -1, 5, 2, -1, 5, 22, 29]);
    expect(Array.from(result.normals)).toEqual([
      0, -0.8320503234863281, 0.5547001957893372,
      0, -0.8320503234863281, 0.5547001957893372,
      0, -0.8320503234863281, 0.5547001957893372,
    ]);
    expect(result.bounds).toEqual({
      min: [-5, 2, -1],
      max: [5, 22, 29],
      size: [10, 20, 30],
    });
  });

  it("uses finite normalized facet normals without recomputing mesh topology", () => {
    const bytes = binaryStl([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    setFacetNormal(bytes, [0, 0, 4]);

    expect(Array.from(parseBinaryStl(bytes).normals)).toEqual([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
  });
});
