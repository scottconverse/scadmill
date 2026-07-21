import { describe, expect, it } from "vitest";

import {
  createBrowserRecentProjectsPersistence,
  createBrowserRecoveryPersistence,
  createBrowserScratchAutosavePersistence,
  createBrowserWorkspaceMetadataPersistence,
} from "../../src/platform-web/browser-project-metadata";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("browser project metadata persistence", () => {
  it("round-trips versioned workspace metadata under its own browser-profile key", () => {
    const storage = new MemoryStorage();
    const persistence = createBrowserWorkspaceMetadataPersistence(storage);

    persistence.save('{"version":1,"files":[]}');

    expect(createBrowserWorkspaceMetadataPersistence(storage).load()).toBe(
      '{"version":1,"files":[]}',
    );
    expect(storage.values.get("scadmill.workspace-metadata.v1")).toBe(
      '{"version":1,"files":[]}',
    );
  });

  it("round-trips and clears recovery data", () => {
    const storage = new MemoryStorage();
    const persistence = createBrowserRecoveryPersistence(storage);
    persistence.save("recovery-json");
    expect(createBrowserRecoveryPersistence(storage).load()).toBe("recovery-json");
    persistence.clear();
    expect(persistence.load()).toBeNull();
  });

  it("round-trips the scratch entry path and source atomically", () => {
    const storage = new MemoryStorage();
    createBrowserScratchAutosavePersistence(storage).save({
      path: "gear_knob.scad",
      source: "cube(42);",
    });
    expect(createBrowserScratchAutosavePersistence(storage).load()).toEqual({
      path: "gear_knob.scad",
      source: "cube(42);",
    });
    expect(storage.values.get("scadmill.scratch-autosave.v2")).toBe(
      '{"version":2,"path":"gear_knob.scad","source":"cube(42);"}',
    );
  });

  it("migrates legacy scratch source exactly and rejects an unsafe current path", () => {
    const storage = new MemoryStorage();
    storage.setItem("scadmill.scratch-autosave.v1", "// legacy\ncube(7);");
    expect(createBrowserScratchAutosavePersistence(storage).load()).toEqual({
      path: "Untitled.scad",
      source: "// legacy\ncube(7);",
    });

    storage.setItem("scadmill.scratch-autosave.v2", JSON.stringify({
      version: 2,
      path: "../escape.scad",
      source: "sphere(4);",
    }));
    expect(createBrowserScratchAutosavePersistence(storage).load()).toBeNull();
  });

  it("removes legacy scratch only after a versioned snapshot is stored", () => {
    const storage = new MemoryStorage();
    storage.setItem("scadmill.scratch-autosave.v1", "cube(1);");
    const persistence = createBrowserScratchAutosavePersistence(storage);

    persistence.save({ path: "Untitled.scad", source: "cube(2);" });

    expect(storage.values.has("scadmill.scratch-autosave.v1")).toBe(false);
    expect(storage.values.get("scadmill.scratch-autosave.v2")).toBe(
      '{"version":2,"path":"Untitled.scad","source":"cube(2);"}',
    );

    storage.setItem("scadmill.scratch-autosave.v1", "cube(3);");
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key === "scadmill.scratch-autosave.v2") {
        throw new DOMException("blocked", "QuotaExceededError");
      }
      setItem(key, value);
    };

    expect(() => persistence.save({ path: "Untitled.scad", source: "cube(4);" }))
      .toThrow(/could not be autosaved/iu);
    expect(storage.values.get("scadmill.scratch-autosave.v1")).toBe("cube(3);");
  });

  it("round-trips recent projects and rejects malformed stored data", () => {
    const storage = new MemoryStorage();
    const persistence = createBrowserRecentProjectsPersistence(storage);
    persistence.save([{
      projectId: "project-a",
      workspaceIdentity: `desktop-project:${"a".repeat(64)}`,
      displayName: "Project A",
      openedAt: "2026-07-10T00:00:00.000Z",
    }]);
    expect(createBrowserRecentProjectsPersistence(storage).load()).toEqual([{
      projectId: "project-a",
      workspaceIdentity: `desktop-project:${"a".repeat(64)}`,
      displayName: "Project A",
      openedAt: "2026-07-10T00:00:00.000Z",
    }]);
    expect(storage.values.get("scadmill.recent-projects.v2")).toContain('"version":2');
    expect(storage.values.get("scadmill.recent-projects.v2")).toContain(`desktop-project:${"a".repeat(64)}`);
    storage.setItem("scadmill.recent-projects.v2", "{bad");
    expect(persistence.load()).toEqual([]);
  });

  it("migrates v1 recent projects deterministically and removes legacy only after v2 saves", () => {
    const storage = new MemoryStorage();
    storage.setItem("scadmill.recent-projects.v1", JSON.stringify({
      version: 1,
      projects: [{ projectId: "workspace:legacy", displayName: "Legacy", openedAt: "2026-07-10T00:00:00.000Z" }],
    }));
    const persistence = createBrowserRecentProjectsPersistence(storage);

    const migrated = persistence.load();
    expect(migrated).toEqual([{
      projectId: "workspace:legacy",
      workspaceIdentity: "workspace:legacy",
      displayName: "Legacy",
      openedAt: "2026-07-10T00:00:00.000Z",
    }]);
    persistence.save(migrated);
    expect(storage.values.has("scadmill.recent-projects.v1")).toBe(false);
    expect(JSON.parse(storage.values.get("scadmill.recent-projects.v2") ?? "null")).toEqual({
      version: 2,
      projects: migrated,
    });
  });

  it("degrades reads safely and reports blocked writes", () => {
    const blocked = {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("blocked", "QuotaExceededError"); },
      removeItem: () => { throw new DOMException("blocked", "SecurityError"); },
    };
    const recovery = createBrowserRecoveryPersistence(blocked);
    const recent = createBrowserRecentProjectsPersistence(blocked);
    const scratch = createBrowserScratchAutosavePersistence(blocked);
    const workspace = createBrowserWorkspaceMetadataPersistence(blocked);

    expect(recovery.load()).toBeNull();
    expect(() => recovery.save("dirty")).toThrow(/could not be saved/iu);
    expect(() => recovery.clear()).toThrow(/could not be cleared/iu);
    expect(recent.load()).toEqual([]);
    expect(() => recent.save([])).toThrow(/could not be saved/iu);
    expect(scratch.load()).toBeNull();
    expect(() => scratch.save({ path: "Untitled", source: "cube(1);" }))
      .toThrow(/could not be autosaved/iu);
    expect(() => workspace.load()).toThrow(/could not be loaded/iu);
    expect(() => workspace.save("metadata")).toThrow(/could not be saved/iu);
  });
});
