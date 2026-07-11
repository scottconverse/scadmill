import { describe, expect, it } from "vitest";

import { createProjectSnapshot } from "../../src/application/files/project-snapshot";
import {
  createAvailableBrowserProjectStorage,
  createBrowserProjectStorage,
  type ProjectRecordDatabase,
  type StoredProjectRecord,
} from "../../src/platform-web/indexeddb-project-storage";

function memoryDatabase(): ProjectRecordDatabase {
  const records = new Map<string, StoredProjectRecord>();
  return {
    read: async (projectId) => records.get(projectId) ?? null,
    create: async (record) => {
      if (records.has(record.projectId)) throw new Error("Project already exists.");
      records.set(record.projectId, record);
    },
    list: async () => [...records.values()],
    update: async (projectId, transform) => {
      records.set(projectId, transform(records.get(projectId) ?? null));
    },
  };
}

describe("browser IndexedDB project storage", () => {
  it("keeps web startup available when IndexedDB is absent, inaccessible, or fails to open", () => {
    expect(createAvailableBrowserProjectStorage({ indexedDB: undefined })).toBeUndefined();
    const blocked = Object.defineProperty({}, "indexedDB", {
      get: () => { throw new DOMException("blocked", "SecurityError"); },
    });
    expect(createAvailableBrowserProjectStorage(blocked)).toBeUndefined();
    const denied = {
      open: () => { throw new DOMException("denied", "SecurityError"); },
    } as unknown as IDBFactory;
    expect(createAvailableBrowserProjectStorage({ indexedDB: denied })).toBeUndefined();
  });

  it("persists create, move, and delete operations with binary fidelity", async () => {
    const storage = createBrowserProjectStorage(memoryDatabase());

    await storage.write("web-project", "main.scad", "cube(10);");
    await storage.write("web-project", "assets/logo.png", new Uint8Array([0x89, 0x50, 0, 255]));
    await storage.move("web-project", "main.scad", "models/main.scad");
    await storage.trash("web-project", "assets/logo.png");
    const snapshot = await storage.snapshot("web-project");

    expect([...snapshot.files]).toEqual([["models/main.scad", "cube(10);"]]);
  });

  it("replaces a project atomically for ZIP import and returns defensive byte copies", async () => {
    const storage = createBrowserProjectStorage(memoryDatabase());
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.replace(createProjectSnapshot("imported", new Map<string, string | Uint8Array>([
      ["main.scad", "sphere(4);"],
      ["asset.bin", bytes],
    ])));
    bytes[0] = 9;

    const first = await storage.snapshot("imported");
    const firstBytes = first.files.get("asset.bin" as never) as Uint8Array;
    firstBytes[1] = 8;
    const second = await storage.snapshot("imported");

    expect(second.files.get("main.scad" as never)).toBe("sphere(4);");
    expect(second.files.get("asset.bin" as never)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("does not expose a desktop reveal action on the web target", async () => {
    const storage = createBrowserProjectStorage(memoryDatabase());
    await storage.write("web-project", "main.scad", "cube(1);");

    await expect(storage.reveal("web-project", "main.scad")).rejects.toThrow(/web|browser/u);
  });

  it("creates discoverable workspaces with exclusive opaque identities", async () => {
    const database = memoryDatabase();
    const collision = createBrowserProjectStorage(database, () => "fixed") as ReturnType<
      typeof createBrowserProjectStorage
    > & {
      createWorkspace(displayName: string): Promise<{ projectId: string; displayName: string }>;
      listWorkspaces(): Promise<readonly { projectId: string; displayName: string }[]>;
    };
    await collision.write("workspace:fixed", "placeholder.scad", "");
    await collision.trash("workspace:fixed", "placeholder.scad");

    expect(collision.createWorkspace).toBeTypeOf("function");
    await expect(collision.createWorkspace("Existing name")).rejects.toThrow(/exists/u);
    expect((await collision.snapshot("workspace:fixed")).files.size).toBe(0);

    const storage = createBrowserProjectStorage(database, () => "fresh") as typeof collision;
    await expect(storage.createWorkspace("  Gear Lab  ")).resolves.toEqual({
      projectId: "workspace:fresh",
      displayName: "Gear Lab",
    });
    expect(await storage.listWorkspaces()).toEqual([
      { projectId: "workspace:fixed", displayName: "workspace:fixed" },
      { projectId: "workspace:fresh", displayName: "Gear Lab" },
    ]);
    expect([...((await storage.snapshot("workspace:fresh")).files)]).toEqual([
      ["main.scad", ""],
    ]);
  });

  it("rejects empty, oversized, and control-character workspace names before persistence", async () => {
    const database = memoryDatabase();
    const storage = createBrowserProjectStorage(database, () => "unused");

    await expect(storage.createWorkspace("   ")).rejects.toThrow(/non-empty/u);
    await expect(storage.createWorkspace("x".repeat(121))).rejects.toThrow(/120/u);
    await expect(storage.createWorkspace("bad\nname")).rejects.toThrow(/control/u);
    await expect(database.list()).resolves.toEqual([]);
  });
});
