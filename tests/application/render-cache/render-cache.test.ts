import { describe, expect, it } from "vitest";

import type {
  EngineInfo,
  RenderRequest,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
import {
  createRenderCacheKey,
  estimateRenderCacheEntryBytes,
  RenderCacheKeyIndex,
  RenderMemoryCache,
} from "../../../src/application/render-cache/render-cache";

const engine: EngineInfo = {
  version: "2026.06.12",
  path: "native",
  features: ["manifold", "3mf-color"],
  buildIdentity: "native:sha256:engine-a",
};

function request(overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    entryFile: "main.scad",
    files: new Map<string, string | Uint8Array>([
      ["main.scad", "include <lib.scad>\ncube(size);"],
      ["lib.scad", "size = 10;"],
      ["texture.png", new Uint8Array([1, 2, 3])],
    ]),
    parameters: { size: 10, enabled: true },
    quality: "preview",
    timeoutMs: 30_000,
    previewFacetLimit: 48,
    ...overrides,
  };
}

function result(fill: number, byteLength = 128): RenderSuccess3D {
  return {
    kind: "3d",
    mesh: {
      format: "stl-binary",
      bytes: new Uint8Array(byteLength).fill(fill),
      geometryIdentity: `sha256:${fill.toString(16).padStart(64, "0")}`,
    },
    stats: { triangles: 12, engineTimeMs: 8 },
    diagnostics: [],
    rawLog: "rendered",
  };
}

describe("render cache", () => {
  it("creates an order-stable key over every output-affecting input", async () => {
    const reordered = request({
      files: new Map([...request().files].reverse()),
      parameters: { enabled: true, size: 10 },
    });
    const baseline = await createRenderCacheKey(request(), engine, "C:/OpenSCAD/openscad.exe");

    await expect(createRenderCacheKey(reordered, {
      ...engine,
      features: [...engine.features].reverse(),
    }, "C:/OpenSCAD/openscad.exe")).resolves.toBe(baseline);
    await expect(createRenderCacheKey(request({
      files: new Map([...request().files, ["lib.scad", "size = 11;"]]),
    }), engine, "C:/OpenSCAD/openscad.exe")).resolves.not.toBe(baseline);
    await expect(createRenderCacheKey(request({ parameters: { size: 11, enabled: true } }), engine, "C:/OpenSCAD/openscad.exe")).resolves.not.toBe(baseline);
    await expect(createRenderCacheKey(request({ quality: "full", previewFacetLimit: undefined }), engine, "C:/OpenSCAD/openscad.exe")).resolves.not.toBe(baseline);
    await expect(createRenderCacheKey(request({ previewFacetLimit: 96 }), engine, "C:/OpenSCAD/openscad.exe")).resolves.not.toBe(baseline);
    await expect(createRenderCacheKey(request({ timeoutMs: 600_000 }), engine, "C:/OpenSCAD/openscad.exe")).resolves.toBe(baseline);
    await expect(createRenderCacheKey(request(), { ...engine, version: "2026.06.13" }, "C:/OpenSCAD/openscad.exe")).resolves.not.toBe(baseline);
    await expect(createRenderCacheKey(request(), { ...engine, buildIdentity: "native:sha256:engine-b" }, "C:/OpenSCAD/openscad.exe")).resolves.not.toBe(baseline);
    await expect(createRenderCacheKey(request(), engine, "D:/OpenSCAD/openscad.exe")).resolves.not.toBe(baseline);
  });

  it("clones payloads and evicts the least-recently-used entry within its byte budget", async () => {
    const first = result(1);
    const second = result(2);
    const third = result(3);
    const budget = estimateRenderCacheEntryBytes(first) * 2;
    const cache = new RenderMemoryCache(budget);

    await cache.put("project", "first", first);
    await cache.put("project", "second", second);
    const cachedFirst = await cache.get("project", "first");
    expect(cachedFirst?.result).not.toBe(first);
    if (cachedFirst?.result.kind !== "3d") throw new Error("Expected cached 3D geometry.");
    cachedFirst.result.mesh.bytes[0] = 99;
    expect(first.mesh.bytes[0]).toBe(1);

    await cache.put("project", "third", third);

    await expect(cache.get("project", "second")).resolves.toBeUndefined();
    await expect(cache.get("project", "first")).resolves.toMatchObject({ tier: "memory" });
    await expect(cache.get("project", "third")).resolves.toMatchObject({ tier: "memory" });
    expect(cache.byteSize).toBeLessThanOrEqual(budget);
  });

  it("does not retain a single result larger than the configured budget", async () => {
    const cache = new RenderMemoryCache(64);
    await cache.put("project", "large", result(7, 1_024));

    await expect(cache.get("project", "large")).resolves.toBeUndefined();
    expect(cache.entryCount).toBe(0);
  });

  it("bounds the revision-to-key side index independently of geometry eviction", () => {
    const index = new RenderCacheKeyIndex(2);
    index.set("one", "key-one");
    index.set("two", "key-two");
    index.set("three", "key-three");

    expect(index.size).toBe(2);
    expect(index.get("one")).toBeUndefined();
    expect(index.get("two")).toBe("key-two");
    expect(index.get("three")).toBe("key-three");
  });

  it("round-trips a 2D success without sharing mutable bounds", async () => {
    const drawing = {
      kind: "2d" as const,
      svg: "<svg/>",
      boundingBox: { min: [0, 0] as [number, number], max: [10, 20] as [number, number] },
      diagnostics: [],
      rawLog: "rendered",
    };
    const cache = new RenderMemoryCache();

    await cache.put("project", "drawing", drawing);
    const cached = await cache.get("project", "drawing");
    expect(cached?.result).toMatchObject({ kind: "2d", svg: "<svg/>" });
    if (cached?.result.kind !== "2d") throw new Error("Expected cached 2D geometry.");
    cached.result.boundingBox.min[0] = 99;
    expect(drawing.boundingBox.min[0]).toBe(0);
  });
});
