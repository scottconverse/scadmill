import { describe, expect, it, vi } from "vitest";

import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import {
  RENDER_DISK_CACHE_METADATA_RESERVE_BYTES,
  RenderDiskCache,
  type RenderDiskCacheRecord,
  type RenderDiskCacheStorage,
} from "../../../src/application/render-cache/render-disk-cache";

function result(fill = 1): RenderSuccess3D {
  return {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: new Uint8Array([fill, 2, 3]), geometryIdentity: `geometry-${fill}` },
    stats: { triangles: 1, engineTimeMs: 12 },
    diagnostics: [],
    rawLog: "rendered",
  };
}

function storage(): RenderDiskCacheStorage & { values: Map<string, Uint8Array>; touches: string[] } {
  const values = new Map<string, Uint8Array>();
  const times = new Map<string, number>();
  const touches: string[] = [];
  const id = (project: string, key: string) => `${project}:${key}`;
  return {
    values,
    touches,
    async read(project, key) { return values.get(id(project, key)); },
    async write(project, key, bytes) { values.set(id(project, key), bytes.slice()); times.set(id(project, key), Date.now()); },
    async remove(project, key) { values.delete(id(project, key)); times.delete(id(project, key)); },
    async list(project): Promise<readonly RenderDiskCacheRecord[]> {
      return [...values].filter(([key]) => key.startsWith(`${project}:`)).map(([key, bytes]) => ({
        key: key.slice(project.length + 1), byteSize: bytes.byteLength, lastAccessMs: times.get(key) ?? 0,
      }));
    },
    async touch(project, key, atMs) { touches.push(`${project}:${key}`); times.set(id(project, key), atMs); },
  };
}

describe("RenderDiskCache", () => {
  it("stores a versioned digest and removes payloads that fail integrity verification", async () => {
    const backing = storage();
    const cache = new RenderDiskCache(backing);
    await cache.put("project-a", "key-a", result());

    const stored = backing.values.get("project-a:key-a");
    if (!stored) throw new Error("expected persisted envelope");
    const envelope = JSON.parse(new TextDecoder().decode(stored)) as {
      integrity?: { schema?: string; digest?: string };
      payload?: { result?: { rawLog?: string } };
    };
    expect(envelope.integrity).toMatchObject({
      schema: "scadmill-render-cache-integrity-v1",
      digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });

    if (!envelope.payload?.result) throw new Error("expected signed payload");
    envelope.payload.result.rawLog = "tampered after persistence";
    await backing.write("project-a", "key-a", new TextEncoder().encode(JSON.stringify(envelope)));

    await expect(cache.get("project-a", "key-a")).resolves.toBeUndefined();
    expect(backing.values.has("project-a:key-a")).toBe(false);

    await cache.put("project-a", "key-a", result());
    const versioned = backing.values.get("project-a:key-a");
    if (!versioned) throw new Error("expected replacement envelope");
    const wrongVersion = JSON.parse(new TextDecoder().decode(versioned)) as {
      integrity?: { schema?: string };
    };
    if (!wrongVersion.integrity) throw new Error("expected integrity block");
    wrongVersion.integrity.schema = "scadmill-render-cache-integrity-v2";
    await backing.write("project-a", "key-a", new TextEncoder().encode(JSON.stringify(wrongVersion)));

    await expect(cache.get("project-a", "key-a")).resolves.toBeUndefined();
    expect(backing.values.has("project-a:key-a")).toBe(false);
  });

  it("round-trips cloned binary results and labels disk hits", async () => {
    const backing = storage();
    const cache = new RenderDiskCache(backing, { now: () => 42 });
    await cache.put("project-a", "key-a", result());

    const hit = await cache.get("project-a", "key-a");
    expect(hit?.tier).toBe("disk");
    if (hit?.result.kind !== "3d") throw new Error("expected 3D result");
    hit.result.mesh.bytes[0] = 99;
    expect((await cache.get("project-a", "key-a"))?.result).toEqual(result());
    expect(backing.touches).toEqual(["project-a:key-a", "project-a:key-a"]);
  });

  it("clears only the selected project's durable records", async () => {
    const backing = storage();
    const cache = new RenderDiskCache(backing);
    await cache.put("project-a", "one", result(1));
    await cache.put("project-a", "two", result(2));
    await cache.put("project-b", "one", result(3));

    await cache.clear("project-a");

    expect([...backing.values.keys()]).toEqual(["project-b:one"]);

    await cache.put("project-a", "locked", result(4));
    backing.remove = async () => { throw new Error("record locked"); };
    await expect(cache.clear("project-a")).rejects.toThrow("record locked");
    expect(backing.values.has("project-a:locked")).toBe(true);
  });

  it("rejects corrupted or cross-project envelopes and removes corrupted records", async () => {
    const backing = storage();
    const cache = new RenderDiskCache(backing);
    await backing.write("project-a", "key-a", new TextEncoder().encode("not-json"));
    await expect(cache.get("project-a", "key-a")).resolves.toBeUndefined();
    expect(backing.values.has("project-a:key-a")).toBe(false);

    await cache.put("project-a", "key-a", result());
    const envelope = backing.values.get("project-a:key-a");
    if (!envelope) throw new Error("expected persisted envelope");
    await backing.write("project-b", "key-a", envelope);
    await expect(cache.get("project-b", "key-a")).resolves.toBeUndefined();
    expect(backing.values.has("project-b:key-a")).toBe(false);

    await backing.write("project-a", "oversized", envelope);
    await expect(new RenderDiskCache(backing, { maxBytes: envelope.byteLength - 1 }).get("project-a", "oversized")).resolves.toBeUndefined();
    expect(backing.values.has("project-a:oversized")).toBe(false);

    await backing.write("project-a", "invalid-json-envelope", new TextEncoder().encode(JSON.stringify({
      schema: "scadmill-render-cache-entry-v1",
      projectIdentity: "project-a",
      key: "invalid-json-envelope",
      result: { kind: "2d", svg: "<svg/>", boundingBox: { min: [0, 0], max: [1, 1] }, diagnostics: ["invalid"], rawLog: "" },
    })));
    await expect(cache.get("project-a", "invalid-json-envelope")).resolves.toBeUndefined();
    expect(backing.values.has("project-a:invalid-json-envelope")).toBe(false);

    await backing.write("project-a", "invalid-mesh-identity", new TextEncoder().encode(JSON.stringify({
      schema: "scadmill-render-cache-entry-v1",
      projectIdentity: "project-a",
      key: "invalid-mesh-identity",
      result: {
        kind: "3d",
        mesh: { format: "stl-binary", bytes: "AQ==", geometryIdentity: 7 },
        stats: { engineTimeMs: 0 },
        diagnostics: [],
        rawLog: "",
      },
    })));
    await expect(cache.get("project-a", "invalid-mesh-identity")).resolves.toBeUndefined();
    expect(backing.values.has("project-a:invalid-mesh-identity")).toBe(false);
  });

  it("treats storage failures as optional-cache misses and best-effort writes", async () => {
    const backing = storage();
    backing.read = async () => { throw new Error("offline"); };
    backing.list = async () => { throw new Error("offline"); };
    backing.write = async () => { throw new Error("offline"); };
    const cache = new RenderDiskCache(backing);
    await expect(cache.get("project", "key")).resolves.toBeUndefined();
    await expect(cache.put("project", "key", result())).resolves.toBeUndefined();
  });

  it("evicts oldest records within the configured byte budget and drops oversized entries", async () => {
    const backing = storage();
    await new RenderDiskCache(backing).put("project-a", "old", result());
    const recordSize = backing.values.get("project-a:old")?.byteLength ?? 0;
    const cache = new RenderDiskCache(backing, {
      maxBytes: recordSize + RENDER_DISK_CACHE_METADATA_RESERVE_BYTES,
    });
    await cache.put("project-a", "new", result());
    expect(backing.values.has("project-a:old")).toBe(false);
    expect(backing.values.has("project-a:new")).toBe(true);

    const before = backing.values.size;
    await new RenderDiskCache(backing, { maxBytes: 1 }).put("project-a", "too-large", result());
    expect(backing.values.size).toBe(before);
  });

  it("passes the configured byte budget to storage for atomic native enforcement", async () => {
    const backing = storage();
    const write = vi.spyOn(backing, "write");
    await new RenderDiskCache(backing, { maxBytes: 1_000 }).put("project", "key", result());

    expect(write).toHaveBeenCalledWith("project", "key", expect.any(Uint8Array), 1_000);
  });

  it("rejects oversized raw meshes before base64 encoding", async () => {
    const backing = storage();
    const originalBtoa = globalThis.btoa;
    const btoa = vi.fn(() => { throw new Error("encoding should not run"); });
    globalThis.btoa = btoa;
    try {
      await new RenderDiskCache(backing, { maxRecordBytes: 2 }).put("project", "large", {
        ...result(),
        mesh: { ...result().mesh, bytes: new Uint8Array([1, 2, 3]) },
      });
    } finally {
      globalThis.btoa = originalBtoa;
    }
    expect(btoa).not.toHaveBeenCalled();
    expect(backing.values.has("project:large")).toBe(false);
  });

  it("rejects oversized text and logs without allocating an encoded payload", async () => {
    const backing = storage();
    const originalBtoa = globalThis.btoa;
    const btoa = vi.fn(() => { throw new Error("encoding should not run"); });
    globalThis.btoa = btoa;
    try {
      await new RenderDiskCache(backing, { maxRecordBytes: 64 }).put("project", "large-text", {
        kind: "2d",
        svg: "<svg/>".repeat(32),
        boundingBox: { min: [0, 0], max: [1, 1] },
        diagnostics: [],
        rawLog: "x".repeat(32),
      });
    } finally {
      globalThis.btoa = originalBtoa;
    }
    expect(btoa).not.toHaveBeenCalled();
    expect(backing.values.has("project:large-text")).toBe(false);
  });

  it("does not exceed the cap when an eviction fails and evicts the least-recently-used record", async () => {
    const backing = storage();
    const first = new RenderDiskCache(backing);
    await first.put("project", "old", result());
    const recordSize = backing.values.get("project:old")?.byteLength ?? 0;
    const cache = new RenderDiskCache(backing, { maxBytes: recordSize * 2 + 500, now: () => Date.now() + 10_000 });
    await cache.put("project", "second", result());
    await cache.get("project", "old");
    await cache.put("project", "third", result());
    expect(backing.values.has("project:old")).toBe(true);
    expect(backing.values.has("project:second")).toBe(false);
    expect(backing.values.has("project:third")).toBe(true);

    const failing = storage();
    await new RenderDiskCache(failing).put("project", "old", result());
    failing.remove = async () => { throw new Error("locked"); };
    const bounded = new RenderDiskCache(failing, { maxBytes: failing.values.get("project:old")?.byteLength ?? 0 });
    await bounded.put("project", "new", result());
    expect(failing.values.has("project:new")).toBe(false);
  });

  it("serializes concurrent puts for one project", async () => {
    const backing = storage();
    let listCalls = 0;
    let releaseFirstList!: () => void;
    let firstListEntered!: () => void;
    const firstList = new Promise<void>((resolve) => { firstListEntered = resolve; });
    const firstListGate = new Promise<void>((resolve) => { releaseFirstList = resolve; });
    const originalList = backing.list;
    backing.list = async (..._args) => {
      listCalls += 1;
      if (listCalls === 1) {
        firstListEntered();
        await firstListGate;
      }
      const listed = await originalList("project");
      return listed;
    };
    const cache = new RenderDiskCache(backing, { maxBytes: 1_000 });
    const writes = Promise.all([
      cache.put("project", "one", result(1)),
      cache.put("project", "two", result(2)),
      cache.put("project", "three", result(3)),
    ]);
    await firstList;
    expect(listCalls).toBe(1);
    releaseFirstList();
    await writes;
    const storedBytes = [...backing.values]
      .filter(([key]) => key.startsWith("project:"))
      .reduce((sum, [, value]) => sum + value.byteLength, 0);
    expect(storedBytes).toBeLessThanOrEqual(1_000);
  });
});
