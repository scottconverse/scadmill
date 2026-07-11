import { describe, expect, it, vi } from "vitest";

import { isDocumentDirty } from "../../../src/application/documents/document-workspace";
import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import type { RecentProjectsPersistence } from "../../../src/application/files/recent-projects";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

function engine(): EngineService {
  return {
    render: vi.fn().mockReturnValue({
      jobId: "project-render",
      done: Promise.resolve({
        kind: "3d",
        mesh: { format: "stl-binary", bytes: new Uint8Array() },
        stats: { engineTimeMs: 1 },
        diagnostics: [],
        rawLog: "",
      }),
    }),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
}

function memoryStorage(files: Map<string, ProjectFileContent>): ProjectStorage {
  return {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    write: async (_projectId, path, content) => { files.set(path, content); },
    move: async (_projectId, from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`Missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
    trash: async (_projectId, path) => { files.delete(path); },
    reveal: async () => undefined,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("workbench project integration", () => {
  it("discards an async project transition when another project opens first", async () => {
    const started = deferred();
    const release = deferred();
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    const storage: ProjectStorage = {
      snapshot: async (projectId) => createProjectSnapshot(projectId, files),
      write: async (_projectId, path, content) => {
        started.resolve();
        await release.promise;
        files.set(path, content);
      },
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      makeId: (() => {
        let next = 0;
        return () => `transition-${++next}`;
      })(),
      projectStorage: storage,
    });
    const stale = runtime.dispatch({
      kind: "create-project-file",
      origin: "user",
      path: "parts/stale.scad",
      source: "sphere(4);",
    });
    await started.promise;
    const projectB = createProjectSnapshot("project-b", new Map([
      ["main.scad", "cylinder(5);"],
    ]));

    await runtime.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot: projectB,
      displayName: "Project B",
      entryFile: "main.scad",
    });
    release.resolve();
    await stale;

    expect(runtime.project.getState()).toMatchObject({
      displayName: "Project B",
      snapshot: { projectId: "project-b" },
    });
    expect(runtime.documents.getState().documents).toEqual([
      expect.objectContaining({ path: "main.scad", source: "cylinder(5);" }),
    ]);
  });

  it("renders with unopened includes and binary assets from the complete project snapshot", async () => {
    const service = engine();
    const snapshot = createProjectSnapshot("project-a", new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["parts/wheel.scad", "module wheel() { cylinder(4); }"],
      ["assets/reference.stl", new Uint8Array([0, 255, 1])],
    ]));
    const runtime = createWorkbenchRuntime(service, { initialProject: snapshot });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(service.render).toHaveBeenCalledWith(expect.objectContaining({
      entryFile: "main.scad",
      files: new Map<string, ProjectFileContent>([
        ["assets/reference.stl", new Uint8Array([0, 255, 1])],
        ["main.scad", "cube(10);"],
        ["parts/wheel.scad", "module wheel() { cylinder(4); }"],
      ]),
    }));
  });

  it("opens a project file that was not loaded when a diagnostic targets it", async () => {
    const snapshot = createProjectSnapshot("project-a", new Map([
      ["main.scad", "cube(10);"],
      ["parts/wheel.scad", "module wheel() { cylinder(4); }"],
    ]));
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: snapshot,
      makeId: () => "opened-id",
    });

    await runtime.dispatch({
      kind: "open-project-file",
      origin: "user",
      path: "parts/wheel.scad",
    });

    expect(runtime.documents.getState().documents).toContainEqual(expect.objectContaining({
      id: "opened-id",
      path: "parts/wheel.scad",
      source: "module wheel() { cylinder(4); }",
    }));
  });

  it("marks a document clean only after project storage accepts the save", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: memoryStorage(files),
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(20);",
    });

    await runtime.dispatch({ kind: "save-document", origin: "user", documentId: "document-main" });

    expect(files.get("main.scad")).toBe("cube(20);");
    expect(isDocumentDirty(runtime.documents.getState().documents[0])).toBe(false);
    expect(runtime.project.getState().snapshot.files.get("main.scad" as never)).toBe("cube(20);");
  });

  it("applies reload and keep decisions for externally changed open files", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: memoryStorage(files),
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(20);",
    });

    await runtime.dispatch({
      kind: "resolve-external-change",
      origin: "user",
      documentId: "document-main",
      diskSource: "cube(30);",
      choice: "keep",
    });
    expect(runtime.documents.getState().documents[0]).toMatchObject({
      source: "cube(20);",
      savedSource: "cube(30);",
    });

    await runtime.dispatch({
      kind: "resolve-external-change",
      origin: "user",
      documentId: "document-main",
      diskSource: "cube(40);",
      choice: "reload",
    });
    expect(runtime.documents.getState().documents[0]).toMatchObject({
      source: "cube(40);",
      savedSource: "cube(40);",
    });
  });

  it("persists and reloads recent projects across runtime sessions", async () => {
    let saved = [] as ReturnType<RecentProjectsPersistence["load"]>;
    const persistence: RecentProjectsPersistence = {
      load: () => saved,
      save: (projects) => { saved = projects; },
    };
    const snapshot = createProjectSnapshot("C:\\models\\cube", new Map([
      ["main.scad", "cube(10);"],
    ]));
    const first = createWorkbenchRuntime(engine(), {
      recentProjectsPersistence: persistence,
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    });
    await first.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot,
      displayName: "cube",
      entryFile: "main.scad",
    });

    const second = createWorkbenchRuntime(engine(), { recentProjectsPersistence: persistence });

    expect(second.project.getState().recentProjects).toEqual([{
      projectId: "C:\\models\\cube",
      displayName: "cube",
      openedAt: "2026-07-10T00:00:00.000Z",
    }]);
  });
});
