import { describe, expect, it } from "vitest";

import {
  MAX_RENDER_THUMBNAIL_BYTES,
  validateRenderThumbnailRecord,
} from "../../../src/application/render-cache/render-thumbnail-persistence";

const identity = `sha256:${"a".repeat(64)}`;

describe("render thumbnail persistence contract", () => {
  it("normalizes paths and clones binary thumbnail bytes", () => {
    const source = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const validated = validateRenderThumbnailRecord({
      documentPath: "parts/gear.scad",
      renderIdentity: identity,
      capturedAt: "2026-07-17T00:00:00.000Z",
      pngBytes: source,
    });

    source[0] = 0;
    expect(validated.documentPath).toBe("parts/gear.scad");
    expect(validated.pngBytes).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it("rejects unsafe paths, noncanonical identities, bad timestamps, and oversized bytes", () => {
    const valid = {
      documentPath: "main.scad",
      renderIdentity: identity,
      capturedAt: "2026-07-17T00:00:00.000Z",
      pngBytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    };
    expect(() => validateRenderThumbnailRecord({ ...valid, documentPath: "../escape.scad" })).toThrow();
    expect(() => validateRenderThumbnailRecord({ ...valid, documentPath: "parts\\gear.scad" })).toThrow();
    expect(() => validateRenderThumbnailRecord({ ...valid, renderIdentity: "mesh-1" })).toThrow(/SHA-256/iu);
    expect(() => validateRenderThumbnailRecord({ ...valid, capturedAt: "today" })).toThrow(/timestamp/iu);
    expect(() => validateRenderThumbnailRecord({ ...valid, pngBytes: new Uint8Array(MAX_RENDER_THUMBNAIL_BYTES + 1) })).toThrow(/size/iu);
  });
});
