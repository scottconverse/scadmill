import { describe, expect, it, vi } from "vitest";

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
  TieredRenderCache,
} from "../../../src/application/render-cache/render-cache";
import type { RenderCache } from "../../../src/application/render-cache/render-cache";

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
      files: new Map([...request().files, ["texture.png", new Uint8Array([9, 9, 9])]]),
    }), engine, "C:/OpenSCAD/openscad.exe")).resolves.toBe(baseline);
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

  it("falls back to all files when an import path is dynamic", async () => {
    const dynamic = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "import(asset);"],
      ["asset.stl", new Uint8Array([1, 2, 3])],
      ["unrelated.scad", "cube();"],
    ]) });
    const changed = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "import(asset);"],
      ["asset.stl", new Uint8Array([1, 2, 3])],
      ["unrelated.scad", "sphere();"],
    ]) });
    await expect(createRenderCacheKey(dynamic, engine, "native")).resolves.not.toBe(
      await createRenderCacheKey(changed, engine, "native"),
    );
  });

  it("tracks literal imports nested in conditional statements", async () => {
    const baseline = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "if (show) import(\"asset.stl\");"],
      ["asset.stl", new Uint8Array([1, 2, 3])],
      ["unrelated.scad", "cube();"],
    ]) });
    const changed = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "if (show) import(\"asset.stl\");"],
      ["asset.stl", new Uint8Array([9, 9, 9])],
      ["unrelated.scad", "cube();"],
    ]) });
    await expect(createRenderCacheKey(baseline, engine, "native")).resolves.not.toBe(
      await createRenderCacheKey(changed, engine, "native"),
    );
  });

  it("tracks include and use statements nested on the same line", async () => {
    const baseline = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "if (show) include <asset.scad>; { use <lib.scad>; }"],
      ["asset.scad", "cube();"],
      ["lib.scad", "module part() {}"],
    ]) });
    const changed = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "if (show) include <asset.scad>; { use <lib.scad>; }"],
      ["asset.scad", "sphere();"],
      ["lib.scad", "module part() {}"],
    ]) });
    await expect(createRenderCacheKey(baseline, engine, "native")).resolves.not.toBe(
      await createRenderCacheKey(changed, engine, "native"),
    );
  });

  it("refuses to cache when a literal dependency is outside the byte map", async () => {
    const unresolved = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "include <external-lib.scad>;"],
    ]) });
    await expect(createRenderCacheKey(unresolved, engine, "native")).resolves.toBeUndefined();
    const caseMapped = request({ files: new Map<string, string | Uint8Array>([
      ["main.scad", "include <Lib.scad>;"],
      ["lib.scad", "cube();"],
    ]) });
    await expect(createRenderCacheKey(caseMapped, engine, "native")).resolves.toBeDefined();
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

  it("returns memory before disk and warms memory on a disk hit", async () => {
    const memory = new RenderMemoryCache();
    const disk = new RenderMemoryCache();
    const tiered = new TieredRenderCache(memory, disk);
    await disk.put("project", "key", result(4));

    const diskHit = await tiered.get("project", "key");
    expect(diskHit?.tier).toBe("memory");
    expect(await memory.get("project", "key")).toBeDefined();
  });

  it("does not call or persist to a disabled disk tier", async () => {
    const memory = new RenderMemoryCache();
    const disk = { get: vi.fn(), put: vi.fn() } satisfies Pick<RenderCache, "get" | "put">;
    const tiered = new TieredRenderCache(memory, disk, () => false);
    expect(tiered.requiresColdLookup).toBe(false);
    await tiered.put("project", "key", result(5));
    expect(disk.put).not.toHaveBeenCalled();
    expect(await tiered.get("project", "key")).toMatchObject({ tier: "memory" });
    expect(disk.get).not.toHaveBeenCalled();
  });
});
