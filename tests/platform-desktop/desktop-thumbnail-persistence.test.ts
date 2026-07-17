import { describe, expect, it } from "vitest";

import { createDesktopRenderThumbnailPersistence } from "../../src/platform-desktop/desktop-thumbnail-persistence";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const workspaceIdentity = `desktop-project:${"a".repeat(64)}`;
const renderIdentity = `sha256:${"b".repeat(64)}`;
const png = (suffix: number) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, suffix]);

describe("desktop render thumbnail persistence", () => {
  it("round-trips cloned binary records under an app-owned opaque workspace key", () => {
    const storage = new MemoryStorage();
    const persistence = createDesktopRenderThumbnailPersistence(storage);
    const bytes = png(1);
    persistence.save(workspaceIdentity, {
      documentPath: "parts/gear.scad",
      renderIdentity,
      capturedAt: "2026-07-17T00:00:00.000Z",
      pngBytes: bytes,
    });
    bytes[4] = 9;

    const loaded = createDesktopRenderThumbnailPersistence(storage).load(workspaceIdentity);
    expect(loaded).toEqual([{
      documentPath: "parts/gear.scad",
      renderIdentity,
      capturedAt: "2026-07-17T00:00:00.000Z",
      pngBytes: png(1),
    }]);
    loaded[0].pngBytes[0] = 0;
    expect(persistence.load(workspaceIdentity)[0].pngBytes[0]).toBe(137);
    expect([...storage.values.keys()]).toEqual([
      `scadmill.desktop-render-thumbnails.v1:${workspaceIdentity}`,
    ]);
  });

  it("replaces only the matching document and clears the workspace atomically", () => {
    const storage = new MemoryStorage();
    const persistence = createDesktopRenderThumbnailPersistence(storage);
    persistence.save(workspaceIdentity, {
      documentPath: "main.scad",
      renderIdentity,
      capturedAt: "2026-07-17T00:00:00.000Z",
      pngBytes: png(1),
    });
    persistence.save(workspaceIdentity, {
      documentPath: "main.scad",
      renderIdentity: `sha256:${"c".repeat(64)}`,
      capturedAt: "2026-07-17T01:00:00.000Z",
      pngBytes: png(2),
    });

    expect(persistence.load(workspaceIdentity)).toHaveLength(1);
    expect(persistence.load(workspaceIdentity)[0].pngBytes).toEqual(png(2));
    persistence.clear(workspaceIdentity);
    expect(persistence.load(workspaceIdentity)).toEqual([]);
  });

  it("fails closed on malformed data and never accepts a source path as workspace identity", () => {
    const storage = new MemoryStorage();
    const persistence = createDesktopRenderThumbnailPersistence(storage);
    const key = `scadmill.desktop-render-thumbnails.v1:${workspaceIdentity}`;
    storage.setItem(key, '{"version":1,"records":[],"extra":true}');
    expect(persistence.load(workspaceIdentity)).toEqual([]);
    expect(persistence.load("C:\\Models\\Secret")).toEqual([]);
    expect(() => persistence.save("C:\\Models\\Secret", {
      documentPath: "main.scad",
      renderIdentity,
      capturedAt: "2026-07-17T00:00:00.000Z",
      pngBytes: png(1),
    })).toThrow(/opaque desktop project identity/iu);
    expect([...storage.values.keys()].join("\n")).not.toContain("Models");
  });
});
