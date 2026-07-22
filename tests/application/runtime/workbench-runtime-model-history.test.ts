import { expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess2D } from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE } from "../../../src/application/model-history/model-history";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { createBrowserModelHistoryPersistence } from "../../../src/platform-desktop/model-history-persistence";

const SUCCESS: RenderSuccess2D = {
  kind: "2d",
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
  boundingBox: { min: [0, 0], max: [10, 10] },
  diagnostics: [],
  rawLog: "",
};

function successfulEngine(): EngineService {
  let run = 0;
  return {
    render: vi.fn(() => ({
      jobId: `model-history-render-${++run}`,
      done: Promise.resolve(SUCCESS),
      subscribeOutput: () => () => undefined,
    })),
    export: vi.fn(),
    version: vi.fn().mockResolvedValue({ version: "2026.06.12", path: "native", features: [] }),
    cancel: vi.fn(),
  };
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

it("AC-15.c records five distinct model snapshots after five successful renders", async () => {
  const runtime = createWorkbenchRuntime(successfulEngine(), {
    initialScratchSource: "width = 10; cube(width);",
    renderCache: null,
    rendering: { autoRender: false },
  });

  for (let index = 0; index < 5; index += 1) {
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });
  }

  expect(runtime.modelHistory.getState()).toHaveLength(5);
  expect(runtime.modelHistory.getState().map(({ source }) => source)).toEqual(
    Array.from({ length: 5 }, () => "width = 10; cube(width);"),
  );
  expect(new Set(runtime.modelHistory.getState().map(({ snapshotId }) => snapshotId)).size).toBe(5);
  runtime.dispose();
});

it("AC-15.c restores snapshot two as one undoable command", async () => {
  const runtime = createWorkbenchRuntime(successfulEngine(), {
    initialScratchSource: "cube(1);",
    renderCache: null,
    rendering: { autoRender: false },
  });

  for (let index = 1; index <= 5; index += 1) {
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: `cube(${index});`,
    });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });
  }
  const snapshotTwo = runtime.modelHistory.getState()[1];
  if (!snapshotTwo) throw new Error("Expected the second model snapshot.");

  await runtime.dispatch({
    kind: "restore-model-history-snapshot",
    origin: "user",
    snapshotId: snapshotTwo.snapshotId,
  });

  expect(runtime.documents.getState().documents[0]?.source).toBe("cube(2);");
  expect(runtime.history.getState().at(-1)).toMatchObject({
    kind: "restore-model-history-snapshot",
    undoable: true,
  });
  await runtime.dispatch({ kind: "history-undo", origin: "user" });
  expect(runtime.documents.getState().documents[0]?.source).toBe("cube(5);");
  await runtime.dispatch({ kind: "history-redo", origin: "user" });
  expect(runtime.documents.getState().documents[0]?.source).toBe("cube(2);");
  runtime.dispose();
});

it("attaches a rendered PNG thumbnail to the matching model snapshot", async () => {
  const runtime = createWorkbenchRuntime(successfulEngine(), {
    renderCache: null,
    rendering: { autoRender: false },
  });
  await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  const snapshot = runtime.modelHistory.getState()[0];
  if (!snapshot) throw new Error("Expected a model snapshot.");
  const pngBytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1);

  await runtime.dispatch({
    kind: "attach-model-history-thumbnail",
    origin: "system",
    workspaceIdentity: snapshot.workspaceIdentity,
    snapshotId: snapshot.snapshotId,
    pngBytes,
  });
  pngBytes[8] = 99;

  expect(runtime.modelHistory.getState()[0]?.thumbnailPng).toEqual(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1),
  );
  runtime.dispose();
});

it("reuses unchanged thumbnail storage as later model snapshots are captured and updated", async () => {
  const runtime = createWorkbenchRuntime(successfulEngine(), {
    renderCache: null,
    rendering: { autoRender: false },
  });
  const pngBytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1);
  await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  const first = runtime.modelHistory.getState()[0];
  if (!first) throw new Error("Expected the first model snapshot.");
  await runtime.dispatch({
    kind: "attach-model-history-thumbnail",
    origin: "system",
    workspaceIdentity: first.workspaceIdentity,
    snapshotId: first.snapshotId,
    pngBytes,
  });
  const retainedThumbnail = runtime.modelHistory.getState()[0]?.thumbnailPng;
  if (!retainedThumbnail) throw new Error("Expected the first model thumbnail.");

  await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  expect(runtime.modelHistory.getState()[0]?.thumbnailPng).toBe(retainedThumbnail);
  const second = runtime.modelHistory.getState()[1];
  if (!second) throw new Error("Expected the second model snapshot.");
  await runtime.dispatch({
    kind: "attach-model-history-thumbnail",
    origin: "system",
    workspaceIdentity: second.workspaceIdentity,
    snapshotId: second.snapshotId,
    pngBytes,
  });

  expect(runtime.modelHistory.getState()[0]?.thumbnailPng).toBe(retainedThumbnail);
  runtime.dispose();
});

it("keeps the incremental model-history view aligned with the workspace snapshot cap", async () => {
  const runtime = createWorkbenchRuntime(successfulEngine(), {
    renderCache: null,
    rendering: { autoRender: false },
  });
  for (let index = 0; index <= MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE; index += 1) {
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  }

  const snapshots = runtime.modelHistory.getState();
  expect(snapshots).toHaveLength(MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE);
  expect(snapshots[0]?.snapshotId).toMatch(/:2$/u);
  expect(snapshots.at(-1)?.snapshotId).toMatch(
    new RegExp(`:${MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE + 1}$`, "u"),
  );
  runtime.dispose();
});

it("evicts only the oldest snapshot in an overflowing workspace", async () => {
  const projectA = createProjectSnapshot(
    "project-a",
    new Map([["main.scad", "cube(10);"]]),
    "workspace-a",
  );
  const projectB = createProjectSnapshot(
    "project-b",
    new Map([["main.scad", "sphere(5);"]]),
    "workspace-b",
  );
  const runtime = createWorkbenchRuntime(successfulEngine(), {
    initialProject: projectA,
    renderCache: null,
    rendering: { autoRender: false },
  });
  await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  await runtime.dispatch({
    kind: "replace-project-confirmed",
    origin: "user",
    snapshot: projectB,
    displayName: "Project B",
    entryFile: "main.scad",
  });
  await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  const workspaceBSnapshot = runtime.modelHistory.getState()[1];
  if (!workspaceBSnapshot) throw new Error("Expected the workspace B snapshot.");
  await runtime.dispatch({
    kind: "replace-project-confirmed",
    origin: "user",
    snapshot: projectA,
    displayName: "Project A",
    entryFile: "main.scad",
  });
  for (let index = 1; index < MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE; index += 1) {
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  }

  const beforeOverflow = runtime.modelHistory.getState();
  expect(beforeOverflow[0]?.workspaceIdentity).toBe("workspace-a");
  expect(beforeOverflow[1]).toBe(workspaceBSnapshot);
  await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

  const afterOverflow = runtime.modelHistory.getState();
  expect(afterOverflow).toHaveLength(MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE + 1);
  expect(afterOverflow[0]).toBe(workspaceBSnapshot);
  expect(afterOverflow.filter(({ workspaceIdentity }) => workspaceIdentity === "workspace-a"))
    .toHaveLength(MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE);
  runtime.dispose();
});

it("persists bounded project history only after the user opts in", async () => {
  const persistence = createBrowserModelHistoryPersistence(new MemoryStorage());
  const initialProject = createProjectSnapshot(
    "project-a",
    new Map([["main.scad", "cube(10);"]]),
    "project-a",
  );
  const first = createWorkbenchRuntime(successfulEngine(), {
    initialProject,
    modelHistoryPersistence: persistence,
    renderCache: null,
    rendering: { autoRender: false },
  });
  expect(first.modelHistoryPersistence.getState()).toMatchObject({
    supported: true,
    enabled: false,
  });
  await first.dispatch({ kind: "render-active", origin: "user", quality: "full" });
  expect(persistence.load("project-a")).toEqual([]);

  await first.dispatch({
    kind: "set-project-model-history-persistence",
    origin: "user",
    enabled: true,
  });
  first.dispose();

  const restored = createWorkbenchRuntime(successfulEngine(), {
    initialProject,
    modelHistoryPersistence: persistence,
    renderCache: null,
    rendering: { autoRender: false },
  });
  expect(restored.modelHistory.getState()).toHaveLength(1);
  expect(restored.modelHistory.getState()[0]?.source).toBe("cube(10);");
  expect(restored.modelHistoryPersistence.getState()).toMatchObject({
    supported: true,
    enabled: true,
  });
  await restored.dispatch({
    kind: "set-project-model-history-persistence",
    origin: "user",
    enabled: false,
  });
  expect(persistence.load("project-a")).toEqual([]);
  restored.dispose();
});

it("restores session history after reopening the same project with new document ids", async () => {
  let nextId = 0;
  const projectA = createProjectSnapshot(
    "project-a",
    new Map([["main.scad", "cube(10);"]]),
    "workspace-a",
  );
  const projectB = createProjectSnapshot(
    "project-b",
    new Map([["other.scad", "sphere(5);"]]),
    "workspace-b",
  );
  const runtime = createWorkbenchRuntime(successfulEngine(), {
    initialProject: projectA,
    makeId: () => `generated-${++nextId}`,
    renderCache: null,
    rendering: { autoRender: false },
  });
  await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });
  const original = runtime.modelHistory.getState()[0];
  if (!original) throw new Error("Expected project A history.");

  await runtime.dispatch({
    kind: "replace-project-confirmed",
    origin: "user",
    snapshot: projectB,
    displayName: "Project B",
    entryFile: "other.scad",
  });
  await runtime.dispatch({
    kind: "replace-project-confirmed",
    origin: "user",
    snapshot: projectA,
    displayName: "Project A",
    entryFile: "main.scad",
  });
  expect(runtime.documents.getState().activeDocumentId).not.toBe(original.documentId);

  await runtime.dispatch({
    kind: "restore-model-history-snapshot",
    origin: "user",
    snapshotId: original.snapshotId,
  });

  expect(runtime.documents.getState().documents[0]?.source).toBe("cube(10);");
  runtime.dispose();
});
