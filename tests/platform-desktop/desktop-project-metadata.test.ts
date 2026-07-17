import { expect, it } from "vitest";

import {
  createDesktopRecentProjectsPersistence,
  createDesktopRenderDiskCachePreferencePersistence,
  createDesktopRecoveryPersistence,
  createDesktopScratchAutosavePersistence,
  createDesktopWorkspaceLayoutPersistence,
  createDesktopWorkspaceMetadataPersistence,
} from "../../src/platform-desktop/desktop-project-metadata";

it("uses durable desktop-webview storage for C6 recovery, recent projects, and scratch autosave", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  createDesktopRecoveryPersistence(storage).save("recovery");
  createDesktopScratchAutosavePersistence(storage).save({
    path: "gear_knob.scad",
    source: "cube(3);",
  });
  createDesktopRecentProjectsPersistence(storage).save([{
    projectId: "project-a",
    displayName: "Project A",
    openedAt: "2026-07-10T00:00:00.000Z",
  }]);

  expect(createDesktopRecoveryPersistence(storage).load()).toBe("recovery");
  expect(createDesktopScratchAutosavePersistence(storage).load()).toEqual({
    path: "gear_knob.scad",
    source: "cube(3);",
  });
  expect(createDesktopRecentProjectsPersistence(storage).load()).toHaveLength(1);
});

it("uses durable desktop-webview storage for workspace annotation metadata", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };

  createDesktopWorkspaceMetadataPersistence(storage).save('{"version":1,"files":[]}');

  expect(createDesktopWorkspaceMetadataPersistence(storage).load()).toBe(
    '{"version":1,"files":[]}',
  );
});

it("persists scratch and project layouts under separate opaque desktop keys", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createDesktopWorkspaceLayoutPersistence(storage);
  const projectA = `desktop-project:${"a".repeat(64)}`;
  const projectB = `desktop-project:${"b".repeat(64)}`;

  persistence.save("scratch", "scratch-layout");
  persistence.save(projectA, "project-a-layout");
  persistence.save(projectB, "project-b-layout");

  expect(persistence.load("scratch")).toBe("scratch-layout");
  expect(persistence.load(projectA)).toBe("project-a-layout");
  expect(persistence.load(projectB)).toBe("project-b-layout");
  const beforeRawPath = new Map(values);
  persistence.save("C:\\Models\\Secret", "must-not-persist");
  expect(persistence.load("C:\\Models\\Secret")).toBeNull();
  expect(values).toEqual(beforeRawPath);
  expect([...values.entries()].flat().join("\n")).not.toContain("C:\\Models");
});

it("persists render-cache consent independently for each opaque desktop project", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createDesktopRenderDiskCachePreferencePersistence(storage);
  const projectA = `desktop-project:${"a".repeat(64)}`;
  const projectB = `desktop-project:${"b".repeat(64)}`;

  persistence.save(projectA, true);
  expect(persistence.load(projectA)).toBe(true);
  expect(persistence.load(projectB)).toBe(false);
  persistence.save(projectA, false);
  expect(persistence.load(projectA)).toBe(false);
  expect(() => persistence.save("C:\\Models\\Secret", true)).toThrow("opaque desktop project identity");
  expect([...values.keys()].join("\n")).not.toContain("C:\\Models");
});

it("keeps layout state usable when desktop profile storage fails", () => {
  const storage = {
    getItem: (_key: string) => { throw new Error("profile blocked"); },
    setItem: (_key: string, _value: string) => { throw new Error("profile full"); },
    removeItem: (_key: string) => undefined,
  };
  const persistence = createDesktopWorkspaceLayoutPersistence(storage);
  const identity = `desktop-project:${"c".repeat(64)}`;

  expect(persistence.load(identity)).toBeNull();
  expect(() => persistence.save(identity, "layout")).not.toThrow();
  expect(persistence.load("desktop-ephemeral")).toBeNull();
});
