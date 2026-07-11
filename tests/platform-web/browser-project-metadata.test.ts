import { describe, expect, it } from "vitest";

import {
  createBrowserRecentProjectsPersistence,
  createBrowserRecoveryPersistence,
  createBrowserScratchAutosavePersistence,
} from "../../src/platform-web/browser-project-metadata";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("browser project metadata persistence", () => {
  it("round-trips and clears recovery data", () => {
    const storage = new MemoryStorage();
    const persistence = createBrowserRecoveryPersistence(storage);
    persistence.save("recovery-json");
    expect(createBrowserRecoveryPersistence(storage).load()).toBe("recovery-json");
    persistence.clear();
    expect(persistence.load()).toBeNull();
  });

  it("round-trips the original scratch autosave", () => {
    const storage = new MemoryStorage();
    createBrowserScratchAutosavePersistence(storage).save("cube(42);");
    expect(createBrowserScratchAutosavePersistence(storage).load()).toBe("cube(42);");
  });

  it("round-trips recent projects and rejects malformed stored data", () => {
    const storage = new MemoryStorage();
    const persistence = createBrowserRecentProjectsPersistence(storage);
    persistence.save([{
      projectId: "project-a",
      displayName: "Project A",
      openedAt: "2026-07-10T00:00:00.000Z",
    }]);
    expect(createBrowserRecentProjectsPersistence(storage).load()).toEqual([{
      projectId: "project-a",
      displayName: "Project A",
      openedAt: "2026-07-10T00:00:00.000Z",
    }]);
    storage.setItem("scadmill.recent-projects.v1", "{bad");
    expect(persistence.load()).toEqual([]);
  });

  it("degrades reads safely and reports blocked writes", () => {
    const blocked = {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("blocked", "QuotaExceededError"); },
      removeItem: () => { throw new DOMException("blocked", "SecurityError"); },
    };
    const recovery = createBrowserRecoveryPersistence(blocked);
    const recent = createBrowserRecentProjectsPersistence(blocked);

    expect(recovery.load()).toBeNull();
    expect(() => recovery.save("dirty")).toThrow(/could not be saved/iu);
    expect(() => recovery.clear()).toThrow(/could not be cleared/iu);
    expect(recent.load()).toEqual([]);
    expect(() => recent.save([])).toThrow(/could not be saved/iu);
  });
});
