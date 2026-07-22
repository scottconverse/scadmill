import { strToU8, zipSync, type ZipOptions, type Zippable } from "fflate";
import { describe, expect, it } from "vitest";

import {
  ensureGeometryIdentity,
  sha256GeometryIdentity,
} from "../../../src/application/geometry/geometry-identity";

const THREE_MF_MODEL = `<?xml version="1.0" encoding="utf-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" unit="millimeter">
  <metadata name="CreationDate">2026-07-22T08:00:00Z</metadata>
  <resources>
    <m:colorgroup id="3"><m:color color="#FF0000FF" /></m:colorgroup>
    <object id="1" name="Part" type="model" p:UUID="11111111-1111-1111-1111-111111111111" pid="3" pindex="0">
      <mesh><vertices>
        <vertex x="0" y="0" z="0" /><vertex x="1" y="0" z="0" /><vertex x="0" y="1" z="0" />
      </vertices><triangles><triangle v1="0" v2="1" v3="2" /></triangles></mesh>
    </object>
  </resources>
  <build p:UUID="22222222-2222-2222-2222-222222222222"><item objectid="1" p:UUID="33333333-3333-3333-3333-333333333333" transform="1 0 0 0 1 0 0 0 1 0 0 0" /></build>
</model>`;

function threeMfArchive(
  model = THREE_MF_MODEL,
  options: { readonly extraFirst?: boolean; readonly level?: ZipOptions["level"] } = {},
): Uint8Array {
  const modelEntry: Zippable = {
    "3D/3dmodel.model": [strToU8(model), { level: options.level ?? 6 }],
  };
  const metadataEntry: Zippable = {
    "Metadata/thumbnail.txt": strToU8("archive-only metadata"),
  };
  return zipSync(options.extraFirst
    ? { ...metadataEntry, ...modelEntry }
    : { ...modelEntry, ...metadataEntry });
}

describe("geometry identity", () => {
  it("hashes only the visible byte range of a subarray", async () => {
    const storage = Uint8Array.of(9, 1, 2, 3, 9);

    expect(await sha256GeometryIdentity(storage.subarray(1, 4))).toBe(
      "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("removes an engine-supplied identity when application hashing is unavailable", async () => {
    const result = await ensureGeometryIdentity({
      kind: "3d",
      mesh: {
        format: "stl-binary",
        bytes: Uint8Array.of(1, 2, 3),
        geometryIdentity: `sha256:${"a".repeat(64)}`,
      },
      stats: { engineTimeMs: 1 },
      diagnostics: [],
      rawLog: "",
    }, async () => undefined);

    expect(result).toMatchObject({ kind: "3d", mesh: { format: "stl-binary" } });
    if (result.kind !== "3d") throw new Error("Expected 3D geometry.");
    expect(result.mesh.geometryIdentity).toBeUndefined();
  });

  it("uses 3MF triangle geometry rather than ZIP packaging for identity", async () => {
    const parts = [{
      id: "1",
      name: "Part",
      color: "#FF0000",
      triangleOffset: 0,
      triangleCount: 1,
    }] as const;
    const render = (bytes: Uint8Array) => ensureGeometryIdentity({
      kind: "3d" as const,
      mesh: { format: "3mf" as const, bytes, parts },
      stats: { engineTimeMs: 1 },
      diagnostics: [],
      rawLog: "",
    });

    const first = await render(threeMfArchive());
    const presentationOnlyChange = THREE_MF_MODEL
      .replace("2026-07-22T08:00:00Z", "2026-07-22T09:00:00Z")
      .replace(/11111111-1111-1111-1111-111111111111/gu, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
      .replace(/22222222-2222-2222-2222-222222222222/gu, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
      .replace(/33333333-3333-3333-3333-333333333333/gu, "cccccccc-cccc-cccc-cccc-cccccccccccc")
      .replace('name="Part"', 'name="Renamed part"')
      .replace("#FF0000FF", "#0000FFFF");
    const repackaged = await render(threeMfArchive(presentationOnlyChange, { extraFirst: true, level: 0 }));
    const changed = await render(threeMfArchive(THREE_MF_MODEL.replace('x="1"', 'x="2"')));
    const transformed = await render(threeMfArchive(
      THREE_MF_MODEL.replace('1 0 0 0 1 0 0 0 1 0 0 0', '1 0 0 0 1 0 0 0 1 5 0 0'),
    ));

    if (
      first.kind !== "3d"
      || repackaged.kind !== "3d"
      || changed.kind !== "3d"
      || transformed.kind !== "3d"
    ) {
      throw new Error("Expected 3D geometry.");
    }
    expect(first.mesh.bytes).not.toEqual(repackaged.mesh.bytes);
    expect(first.mesh.geometryIdentity).toBe(repackaged.mesh.geometryIdentity);
    expect(changed.mesh.geometryIdentity).not.toBe(first.mesh.geometryIdentity);
    expect(transformed.mesh.geometryIdentity).not.toBe(first.mesh.geometryIdentity);
    expect(first.mesh.parts).toBe(parts);
  });
});
