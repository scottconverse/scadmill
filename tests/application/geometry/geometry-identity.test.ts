import { describe, expect, it } from "vitest";

import {
  ensureGeometryIdentity,
  sha256GeometryIdentity,
} from "../../../src/application/geometry/geometry-identity";

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
});
