import { expect, it } from "vitest";

import {
  MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE,
  type ModelHistorySnapshot,
} from "../../src/application/model-history/model-history";
import { createBrowserModelHistoryPersistence } from "../../src/platform-desktop/model-history-persistence";
import { parseProjectPath } from "../../src/application/files/project-path";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function snapshot(index: number): ModelHistorySnapshot {
  return {
    snapshotId: `snapshot-${index}`,
    workspaceIdentity: "project-a",
    documentId: "document-main",
    documentPath: parseProjectPath("main.scad"),
    renderIdentity: `render-${index}`,
    capturedAt: new Date(Date.UTC(2026, 6, 21, 12, 0, index)).toISOString(),
    quality: "full",
    source: `cube(${index});`,
    parameters: { width: index },
    thumbnailPng: Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, index),
  };
}

it("keeps project model history disabled until explicitly enabled", () => {
  const persistence = createBrowserModelHistoryPersistence(new MemoryStorage());

  expect(persistence.supportsWorkspace("project-a")).toBe(true);
  expect(persistence.supportsWorkspace("scratch")).toBe(false);
  expect(persistence.isEnabled("project-a")).toBe(false);

  persistence.setEnabled("project-a", true);
  persistence.save("project-a", [snapshot(1)]);

  expect(persistence.isEnabled("project-a")).toBe(true);
  expect(persistence.load("project-a")).toEqual([snapshot(1)]);
});

it("evicts oldest model snapshots at the per-project count cap", () => {
  const persistence = createBrowserModelHistoryPersistence(new MemoryStorage());
  persistence.setEnabled("project-a", true);
  const snapshots = Array.from(
    { length: MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE + 2 },
    (_, index) => snapshot(index),
  );

  persistence.save("project-a", snapshots);

  const loaded = persistence.load("project-a");
  expect(loaded).toHaveLength(MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE);
  expect(loaded[0]?.snapshotId).toBe("snapshot-2");
  expect(loaded.at(-1)?.snapshotId).toBe(
    `snapshot-${MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE + 1}`,
  );
});
