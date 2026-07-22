import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseThreeMf } from "../../../src/application/geometry/three-mf";

const MODEL = `<?xml version="1.0" encoding="utf-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" unit="millimeter">
  <resources>
    <m:colorgroup id="3">
      <m:color color="#FF0000FF" />
      <m:color color="#0000FFFF" />
    </m:colorgroup>
    <object id="1" name="Red bracket" type="model" pid="3" pindex="0">
      <mesh><vertices>
        <vertex x="0" y="0" z="0" /><vertex x="1" y="0" z="0" /><vertex x="0" y="1" z="0" />
      </vertices><triangles><triangle v1="0" v2="1" v3="2" pid="3" p1="0" /></triangles></mesh>
    </object>
    <object id="2" name="Blue bracket" type="model" pid="3" pindex="1">
      <mesh><vertices>
        <vertex x="2" y="0" z="0" /><vertex x="3" y="0" z="0" /><vertex x="2" y="1" z="0" />
      </vertices><triangles><triangle v1="0" v2="1" v3="2" pid="3" p1="1" /></triangles></mesh>
    </object>
  </resources>
  <build><item objectid="1" /><item objectid="2" /></build>
</model>`;

function archive(model = MODEL): Uint8Array {
  return zipSync({ "3D/3dmodel.model": strToU8(model) });
}

describe("3MF model parser", () => {
  it("preserves separate objects and their Color-encoding material references", () => {
    const parsed = parseThreeMf(archive());

    expect(parsed.triangleCount).toBe(2);
    expect(parsed.bounds).toEqual({ min: [0, 0, 0], max: [3, 1, 0], size: [3, 1, 0] });
    expect(parsed.parts).toEqual([
      { id: "1", name: "Red bracket", color: "#FF0000", triangleOffset: 0, triangleCount: 1 },
      { id: "2", name: "Blue bracket", color: "#0000FF", triangleOffset: 1, triangleCount: 1 },
    ]);
    expect([...parsed.colors ?? []]).toEqual([
      1, 0, 0, 1, 0, 0, 1, 0, 0,
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
  });

  it("rejects an archive without the normative model entry", () => {
    expect(() => parseThreeMf(zipSync({ "other.txt": strToU8("no model") })))
      .toThrow("3D/3dmodel.model");
  });

  it("rejects a triangle that references a missing vertex", () => {
    const malformed = MODEL.replace('v3="2" pid="3" p1="0"', 'v3="99" pid="3" p1="0"');
    expect(() => parseThreeMf(archive(malformed))).toThrow("missing vertex");
  });
});
