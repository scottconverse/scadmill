import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseBinaryStl } from "../../../src/application/geometry/stl";
import { manufacturingEstimateStl } from "../../../src/application/manufacturing/manufacturing-estimate-mesh";

function triangleStl(): Uint8Array {
  const bytes = new Uint8Array(134);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  [0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((coordinate, index) => {
    view.setFloat32(96 + index * 4, coordinate, true);
  });
  return bytes;
}

describe("manufacturingEstimateStl", () => {
  it("validates and copies a binary STL without mutating the render result", () => {
    const source = triangleStl();
    const converted = manufacturingEstimateStl(source, "stl-binary");

    expect(converted).not.toBe(source);
    expect(converted).toEqual(source);
    expect(parseBinaryStl(converted).triangleCount).toBe(1);
  });

  it("converts bounded 3MF geometry into the binary STL Kiri:Moto accepts", () => {
    const model = `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
    const converted = manufacturingEstimateStl(
      zipSync({ "3D/3dmodel.model": strToU8(model) }),
      "3mf",
    );

    const parsed = parseBinaryStl(converted);
    expect(parsed.triangleCount).toBe(1);
    expect([...parsed.positions]).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
  });

  it("rejects render formats that are not binary STL or 3MF", () => {
    expect(() => manufacturingEstimateStl(Uint8Array.of(1), "stl-ascii"))
      .toThrow(/binary STL or 3MF/i);
  });
});
