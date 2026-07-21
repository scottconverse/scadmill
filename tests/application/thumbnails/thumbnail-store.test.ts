import { describe, expect, it } from "vitest";
import { parseProjectPath } from "../../../src/application/files/project-path";
import {
  decodeThumbnailRecord,
  encodeThumbnailRecord,
  estimateThumbnailRecordBytes,
  InMemoryThumbnailStore,
  type ThumbnailRecord,
} from "../../../src/application/thumbnails/thumbnail-store";

const GEOMETRY_A = `sha256:${"a".repeat(64)}`;
const PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 240, 0, 0, 0, 160,
]);

function record(overrides: Partial<ThumbnailRecord> = {}): ThumbnailRecord {
  return {
    version: 1,
    workspaceIdentity: "workspace-a",
    documentPath: parseProjectPath("parts/cube.scad"),
    renderIdentity: "render-1",
    geometryIdentity: GEOMETRY_A,
    capturedAtMs: 100,
    width: 240,
    height: 160,
    mimeType: "image/png",
    bytes: PNG,
    ...overrides,
  };
}

function envelope(source: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(source)) as Record<string, unknown>;
}

function encoded(value: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("thumbnail record codec", () => {
  it("round-trips the versioned fixed-size PNG record without sharing byte views", () => {
    const source = record();
    const decoded = decodeThumbnailRecord(encodeThumbnailRecord(source));

    expect(decoded).toEqual(source);
    expect(decoded.bytes).not.toBe(source.bytes);
    decoded.bytes[23] = 99;
    expect(source.bytes[23]).toBe(160);
  });

  it.each([
    ["version", 2],
    ["workspaceIdentity", ""],
    ["documentPath", "../outside.scad"],
    ["renderIdentity", "  "],
    ["geometryIdentity", "sha256:not-a-digest"],
    ["capturedAtMs", -1],
    ["width", 239],
    ["height", 161],
    ["mimeType", "image/jpeg"],
  ])("rejects an invalid %s", (field, value) => {
    const invalid = envelope(encodeThumbnailRecord(record()));
    invalid[field] = value;
    expect(() => decodeThumbnailRecord(encoded(invalid))).toThrow();
  });

  it("rejects unknown fields, non-PNG bytes, malformed base64, and oversized input", () => {
    const valid = envelope(encodeThumbnailRecord(record()));
    expect(() => decodeThumbnailRecord(encoded({ ...valid, surprise: true }))).toThrow();
    expect(() => decodeThumbnailRecord(encoded({ ...valid, bytesBase64: "AQIDBA==" }))).toThrow();
    expect(() => decodeThumbnailRecord(encoded({ ...valid, bytesBase64: "***" }))).toThrow();
    const wrongDimensions = PNG.slice();
    wrongDimensions[19] = 239;
    expect(() => encodeThumbnailRecord(record({ bytes: wrongDimensions }))).toThrow();
    expect(() => decodeThumbnailRecord(new Uint8Array(400_000))).toThrow();
    expect(() => encodeThumbnailRecord(record({ bytes: new Uint8Array(300_000) }))).toThrow();
  });
});

describe("in-memory thumbnail store", () => {
  it("is project-scoped, last-write-wins, newest-first, and clone-safe", () => {
    const store = new InMemoryThumbnailStore();
    store.save(record({ documentPath: parseProjectPath("older.scad"), capturedAtMs: 10 }));
    store.save(record({ documentPath: parseProjectPath("newer.scad"), capturedAtMs: 20 }));
    store.save(record({ renderIdentity: "render-2", capturedAtMs: 30 }));
    store.save(record({ workspaceIdentity: "workspace-b", capturedAtMs: 40 }));

    expect(store.entryCount).toBe(4);
    expect(store.get("workspace-a", parseProjectPath("parts/cube.scad"))?.renderIdentity)
      .toBe("render-2");
    expect(store.listProject("workspace-a").map(({ capturedAtMs }) => capturedAtMs))
      .toEqual([30, 20, 10]);
    expect(store.newestProject("workspace-a")?.capturedAtMs).toBe(30);
    expect(store.newestProject("missing")).toBeUndefined();

    const fetched = store.get("workspace-a", parseProjectPath("parts/cube.scad"));
    if (!fetched) throw new Error("expected thumbnail");
    fetched.bytes[23] = 99;
    expect(store.get("workspace-a", parseProjectPath("parts/cube.scad"))?.bytes[23]).toBe(160);
  });

  it("moves, removes, and evicts the least-recently-used record within a byte budget", () => {
    const one = record({ documentPath: parseProjectPath("one.scad") });
    const two = record({ documentPath: parseProjectPath("two.scad") });
    const three = record({ documentPath: parseProjectPath("tre.scad") });
    const budget = estimateThumbnailRecordBytes(one) + estimateThumbnailRecordBytes(two);
    const store = new InMemoryThumbnailStore(budget);

    store.save(one);
    store.save(two);
    expect(store.get("workspace-a", one.documentPath)).toBeDefined();
    store.save(three);

    expect(store.get("workspace-a", one.documentPath)).toBeDefined();
    expect(store.get("workspace-a", two.documentPath)).toBeUndefined();
    expect(store.get("workspace-a", three.documentPath)).toBeDefined();
    expect(store.byteSize).toBeLessThanOrEqual(budget);

    expect(store.move("workspace-a", three.documentPath, parseProjectPath("renamed.scad"))).toBe(true);
    expect(store.get("workspace-a", three.documentPath)).toBeUndefined();
    expect(store.remove("workspace-a", parseProjectPath("renamed.scad"))).toBe(true);
    expect(store.remove("workspace-a", parseProjectPath("renamed.scad"))).toBe(false);
  });
});
