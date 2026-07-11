import { describe, expect, it } from "vitest";

import { parseBinaryStl } from "../../../src/application/geometry/stl";

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
