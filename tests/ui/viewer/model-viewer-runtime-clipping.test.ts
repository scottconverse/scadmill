import { MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";

import { applyClipping } from "../../../src/ui/viewer/model-viewer-runtime";

describe("applyClipping", () => {
  it("applies an axis-aligned local plane with the selected model-space offset", () => {
    const material = new MeshStandardMaterial();

    applyClipping(material, { enabled: true, axis: "z", offset: 4.5 });

    expect(material.clippingPlanes).toHaveLength(1);
    expect(material.clippingPlanes?.[0]?.normal.toArray()).toEqual([0, 0, 1]);
    expect(material.clippingPlanes?.[0]?.constant).toBe(-4.5);
    expect(material.clipShadows).toBe(true);
  });

  it("removes local clipping when section view is disabled", () => {
    const material = new MeshStandardMaterial();
    applyClipping(material, { enabled: true, axis: "x", offset: 2 });

    applyClipping(material, { enabled: false, axis: "x", offset: 2 });

    expect(material.clippingPlanes).toEqual([]);
    expect(material.clipShadows).toBe(false);
  });
});
