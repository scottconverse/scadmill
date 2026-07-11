import { expect, it } from "vitest";

import {
  createDesktopRecentProjectsPersistence,
  createDesktopRecoveryPersistence,
  createDesktopScratchAutosavePersistence,
} from "../../src/platform-desktop/desktop-project-metadata";

it("uses durable desktop-webview storage for C6 recovery, recent projects, and scratch autosave", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  createDesktopRecoveryPersistence(storage).save("recovery");
  createDesktopScratchAutosavePersistence(storage).save("cube(3);");
  createDesktopRecentProjectsPersistence(storage).save([{
    projectId: "project-a",
    displayName: "Project A",
    openedAt: "2026-07-10T00:00:00.000Z",
  }]);

  expect(createDesktopRecoveryPersistence(storage).load()).toBe("recovery");
  expect(createDesktopScratchAutosavePersistence(storage).load()).toBe("cube(3);");
  expect(createDesktopRecentProjectsPersistence(storage).load()).toHaveLength(1);
});
