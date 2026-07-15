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
import { viewerDocument } from "../../../src/application/viewer/viewer-state";

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
  it("restores per-file annotations across a runtime restart without persisting measurements", async () => {
    let serialized: string | null = null;
    const workspaceMetadataPersistence = {
      load: () => serialized,
      save: (value: string) => { serialized = value; },
    };
    const snapshot = createProjectSnapshot("project-a", new Map([
      ["main.scad", "cube(10);"],
    ]));
    const first = createWorkbenchRuntime(engine(), {
      initialProject: snapshot,
      workspaceMetadataPersistence,
    });

    await first.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "note-a", point: [1, 2, 3], text: "Hole center" },
      },
    });
    await first.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-point-measurement",
        documentId: "document-main",
        measurement: { id: "measure-a", start: [0, 0, 0], end: [1, 1, 1] },
      },
    });

    expect(serialized).not.toBeNull();
    const second = createWorkbenchRuntime(engine(), {
      initialProject: snapshot,
      workspaceMetadataPersistence,
    });
    const restored = viewerDocument(second.viewer.getState(), "document-main");
    expect(restored.annotations).toEqual([
      { id: "note-a", point: [1, 2, 3], text: "Hole center" },
    ]);
    expect(restored.measurements).toEqual([]);
    await second.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "delete-annotation",
        documentId: "document-main",
        annotationId: "note-a",
      },
    });
    const third = createWorkbenchRuntime(engine(), {
      initialProject: snapshot,
      workspaceMetadataPersistence,
    });
    expect(viewerDocument(third.viewer.getState(), "document-main").annotations).toEqual([]);
  });

  it("keeps an annotation usable when workspace metadata persistence rejects the save", async () => {
    let blocked = true;
    let serialized: string | null = null;
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", new Map([
        ["main.scad", "cube(10);"],
      ])),
      workspaceMetadataPersistence: {
        load: () => serialized,
        save: (value) => {
          if (blocked) throw new Error("Profile storage is blocked.");
          serialized = value;
        },
      },
    });

    await expect(runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "local-note", point: [3, 2, 1], text: "Still visible" },
      },
    })).resolves.toBeUndefined();
    expect(viewerDocument(runtime.viewer.getState(), "document-main").annotations).toEqual([
      { id: "local-note", point: [3, 2, 1], text: "Still visible" },
    ]);
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "unsaved" });

    await runtime.dispatch({
      kind: "retry-annotation-persistence",
      origin: "user",
    });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "unsaved" });

    blocked = false;
    await runtime.dispatch({
      kind: "retry-annotation-persistence",
      origin: "user",
    });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "saved" });
    const restored = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", new Map([
        ["main.scad", "cube(10);"],
      ])),
      workspaceMetadataPersistence: {
        load: () => serialized,
        save: () => undefined,
      },
    });
    expect(viewerDocument(restored.viewer.getState(), "document-main").annotations).toEqual([
      { id: "local-note", point: [3, 2, 1], text: "Still visible" },
    ]);
  });

  it("keeps a failed annotation deletion unsaved until retry makes the deletion durable", async () => {
    let blocked = false;
    let serialized: string | null = null;
    const persistence = {
      load: () => serialized,
      save: (value: string) => {
        if (blocked) throw new Error("Quota exceeded.");
        serialized = value;
      },
    };
    const snapshot = createProjectSnapshot("project-a", new Map([["main.scad", "cube(10);"]]));
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: snapshot,
      workspaceMetadataPersistence: persistence,
    });
    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "delete-me", point: [1, 1, 1], text: "Delete me" },
      },
    });
    blocked = true;

    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: { kind: "delete-annotation", documentId: "document-main", annotationId: "delete-me" },
    });

    expect(viewerDocument(runtime.viewer.getState(), "document-main").annotations).toEqual([]);
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "unsaved" });
    expect(serialized).toContain("delete-me");
    blocked = false;
    await runtime.dispatch({ kind: "retry-annotation-persistence", origin: "user" });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "saved" });
    const restarted = createWorkbenchRuntime(engine(), {
      initialProject: snapshot,
      workspaceMetadataPersistence: persistence,
    });
    expect(viewerDocument(restarted.viewer.getState(), "document-main").annotations).toEqual([]);
  });

  it("restores exact annotations when retry recovers from corrupt initial metadata", async () => {
    let serialized = "{corrupt";
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", new Map([["main.scad", "cube(10);"]])),
      workspaceMetadataPersistence: {
        load: () => serialized,
        save: (value) => { serialized = value; },
      },
    });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "load-error" });
    expect(viewerDocument(runtime.viewer.getState(), "document-main").annotations).toEqual([]);
    serialized = '{"version":1,"files":[{"projectId":"project-a","path":"main.scad","annotations":[{"id":"restored","point":[9,8,7],"text":"Recovered"}]}]}';

    await runtime.dispatch({ kind: "retry-annotation-persistence", origin: "user" });

    expect(runtime.annotationPersistence.getState()).toEqual({ status: "saved" });
    expect(viewerDocument(runtime.viewer.getState(), "document-main").annotations).toEqual([
      { id: "restored", point: [9, 8, 7], text: "Recovered" },
    ]);
  });

  it("retains failed move, copy, and delete metadata changes and exports their exact current JSON", async () => {
    let blocked = false;
    let serialized: string | null = null;
    const savedArtifacts: { suggestedName: string; bytes: Uint8Array; mimeType: string }[] = [];
    const files = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["obsolete.scad", "sphere(3);"],
    ]);
    const storage = memoryStorage(files);
    let nextId = 0;
    const runtime = createWorkbenchRuntime(engine(), {
      artifactDestination: {
        available: true,
        save: async (request) => {
          savedArtifacts.push(request);
          return { location: request.suggestedName };
        },
      },
      initialProject: createProjectSnapshot("project-a", files),
      makeId: () => `opened-${++nextId}`,
      projectStorage: storage,
      workspaceMetadataPersistence: {
        load: () => serialized,
        save: (value) => {
          if (blocked) throw new Error("Quota exceeded.");
          serialized = value;
        },
      },
    });
    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "main-note", point: [1, 2, 3], text: "Main" },
      },
    });
    await runtime.dispatch({ kind: "open-project-file", origin: "user", path: "obsolete.scad" });
    const obsoleteDocumentId = runtime.documents.getState().activeDocumentId;
    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: obsoleteDocumentId,
        annotation: { id: "obsolete-note", point: [4, 5, 6], text: "Obsolete" },
      },
    });
    await runtime.dispatch({ kind: "close-document", origin: "user", documentId: obsoleteDocumentId });
    blocked = true;

    await runtime.dispatch({
      kind: "move-project-file",
      origin: "user",
      path: "main.scad",
      destinationPath: "moved.scad",
    });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "unsaved" });
    expect(viewerDocument(runtime.viewer.getState(), "document-main").annotations).toEqual([
      { id: "main-note", point: [1, 2, 3], text: "Main" },
    ]);

    await runtime.dispatch({
      kind: "save-document-as-confirmed",
      origin: "user",
      documentId: "document-main",
      path: "copy.scad",
    });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "unsaved" });
    await runtime.dispatch({ kind: "delete-project-file", origin: "user", path: "obsolete.scad" });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "unsaved" });

    await runtime.dispatch({ kind: "export-annotation-metadata", origin: "user" });
    expect(savedArtifacts).toHaveLength(1);
    expect(savedArtifacts[0]?.suggestedName).toBe("scadmill-annotations-v1.json");
    expect(savedArtifacts[0]?.mimeType).toBe("application/json");
    expect(new TextDecoder().decode(savedArtifacts[0]?.bytes)).toBe(
      '{"version":1,"files":[{"projectId":"project-a","path":"copy.scad","annotations":[{"id":"main-note","point":[1,2,3],"text":"Main"}]},{"projectId":"project-a","path":"moved.scad","annotations":[{"id":"main-note","point":[1,2,3],"text":"Main"}]}]}',
    );
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "unsaved" });

    blocked = false;
    await runtime.dispatch({ kind: "retry-annotation-persistence", origin: "user" });
    expect(runtime.annotationPersistence.getState()).toEqual({ status: "saved" });
    expect(serialized).toBe(new TextDecoder().decode(savedArtifacts[0]?.bytes));

    let reopenedId = 0;
    const restarted = createWorkbenchRuntime(engine(), {
      initialProject: await storage.snapshot("project-a"),
      makeId: () => `restarted-${++reopenedId}`,
      workspaceMetadataPersistence: {
        load: () => serialized,
        save: () => undefined,
      },
    });
    await restarted.dispatch({ kind: "open-project-file", origin: "user", path: "moved.scad" });
    const movedDocumentId = restarted.documents.getState().documents.find(
      ({ path }) => path === "moved.scad",
    )?.id ?? "missing-moved-document";
    expect(viewerDocument(restarted.viewer.getState(), movedDocumentId).annotations).toEqual([
      { id: "main-note", point: [1, 2, 3], text: "Main" },
    ]);
    await restarted.dispatch({ kind: "open-project-file", origin: "user", path: "copy.scad" });
    const copiedDocumentId = restarted.documents.getState().documents.find(
      ({ path }) => path === "copy.scad",
    )?.id ?? "missing-copy-document";
    expect(viewerDocument(restarted.viewer.getState(), copiedDocumentId).annotations).toEqual([
      { id: "main-note", point: [1, 2, 3], text: "Main" },
    ]);
  });

  it("isolates annotations by project and path when projects and files reopen", async () => {
    let serialized: string | null = null;
    const workspaceMetadataPersistence = {
      load: () => serialized,
      save: (value: string) => { serialized = value; },
    };
    const projectA = createProjectSnapshot("project-a", new Map([
      ["main.scad", "cube(10);"],
      ["parts/wheel.scad", "cylinder(4);"],
    ]));
    const projectB = createProjectSnapshot("project-b", new Map([
      ["main.scad", "sphere(10);"],
    ]));
    let nextId = 0;
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: projectA,
      makeId: () => `opened-${++nextId}`,
      workspaceMetadataPersistence,
    });
    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "main-note", point: [1, 2, 3], text: "Project A main" },
      },
    });
    await runtime.dispatch({ kind: "open-project-file", origin: "user", path: "parts/wheel.scad" });
    const wheelId = runtime.documents.getState().activeDocumentId;
    expect(viewerDocument(runtime.viewer.getState(), wheelId).annotations).toEqual([]);
    await runtime.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: wheelId,
        annotation: { id: "wheel-note", point: [4, 5, 6], text: "Project A wheel" },
      },
    });

    await runtime.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot: projectB,
      displayName: "Project B",
      entryFile: "main.scad",
    });
    const projectBMainId = runtime.documents.getState().activeDocumentId;
    expect(viewerDocument(runtime.viewer.getState(), projectBMainId).annotations).toEqual([]);

    await runtime.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot: projectA,
      displayName: "Project A",
      entryFile: "main.scad",
    });
    const projectAMainId = runtime.documents.getState().activeDocumentId;
    expect(viewerDocument(runtime.viewer.getState(), projectAMainId).annotations).toEqual([
      { id: "main-note", point: [1, 2, 3], text: "Project A main" },
    ]);
    await runtime.dispatch({ kind: "open-project-file", origin: "user", path: "parts/wheel.scad" });
    const reopenedWheelId = runtime.documents.getState().activeDocumentId;
    expect(viewerDocument(runtime.viewer.getState(), reopenedWheelId).annotations).toEqual([
      { id: "wheel-note", point: [4, 5, 6], text: "Project A wheel" },
    ]);
  });

  it("moves durable annotations with a project file path", async () => {
    let serialized: string | null = null;
    const workspaceMetadataPersistence = {
      load: () => serialized,
      save: (value: string) => { serialized = value; },
    };
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    const storage = memoryStorage(files);
    const first = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: storage,
      workspaceMetadataPersistence,
    });
    await first.dispatch({
      kind: "update-viewer",
      origin: "user",
      action: {
        kind: "add-annotation",
        documentId: "document-main",
        annotation: { id: "moved-note", point: [2, 4, 6], text: "Moves with file" },
      },
    });

    await first.dispatch({
      kind: "move-project-file",
      origin: "user",
      path: "main.scad",
      destinationPath: "parts/design.scad",
    });

    const second = createWorkbenchRuntime(engine(), {
      initialProject: await storage.snapshot("project-a"),
      makeId: () => "reopened-design",
      workspaceMetadataPersistence,
    });
    await second.dispatch({
      kind: "open-project-file",
      origin: "user",
      path: "parts/design.scad",
    });
    expect(viewerDocument(second.viewer.getState(), "reopened-design").annotations).toEqual([
      { id: "moved-note", point: [2, 4, 6], text: "Moves with file" },
    ]);
  });

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

  it("rejects a recovery transition if the workspace changes before atomic apply", async () => {
    const runtime = createWorkbenchRuntime(engine());
    const beforeProject = runtime.project.getState();
    const beforeWorkspace = runtime.documents.getState();
    const restoring = runtime.dispatch({
      kind: "restore-recovery-confirmed",
      origin: "system",
      expectedProject: beforeProject,
      expectedWorkspace: beforeWorkspace,
      recovery: {
        version: 1,
        projectId: "scratch",
        capturedAt: "2026-07-10T00:00:00.000Z",
        buffers: [{
          documentId: "document-main",
          path: "main.scad",
          source: "cube(77);",
          savedSource: "cube(10);",
        }],
      },
    });
    const rejected = expect(restoring).rejects.toThrow(/workspace changed/iu);

    await runtime.dispatch({
      kind: "open-document",
      origin: "user",
      document: { id: "clean-notes", path: "notes.scad", source: "sphere(2);" },
    });

    await rejected;
    expect(runtime.project.getState()).toBe(beforeProject);
    expect(runtime.documents.getState().documents.map(({ path, source }) => ({ path, source })))
      .toEqual([
        { path: "main.scad", source: "cube(10);" },
        { path: "notes.scad", source: "sphere(2);" },
      ]);
    runtime.dispose();
  });

  it("does not apply recovery when replacement layout loading fails", async () => {
    let loadCount = 0;
    const runtime = createWorkbenchRuntime(engine(), {
      layoutPersistence: {
        load: () => {
          loadCount += 1;
          if (loadCount > 1) throw new Error("Layout storage failed.");
          return null;
        },
        save: () => undefined,
      },
    });
    const beforeProject = runtime.project.getState();
    const beforeWorkspace = runtime.documents.getState();

    await expect(runtime.dispatch({
      kind: "restore-recovery-confirmed",
      origin: "system",
      expectedProject: beforeProject,
      expectedWorkspace: beforeWorkspace,
      recovery: {
        version: 1,
        projectId: "scratch",
        capturedAt: "2026-07-10T00:00:00.000Z",
        buffers: [{
          documentId: "document-main",
          path: "main.scad",
          source: "cube(77);",
          savedSource: "cube(10);",
        }],
      },
    })).rejects.toThrow("Layout storage failed.");

    expect(runtime.project.getState()).toBe(beforeProject);
    expect(runtime.documents.getState()).toBe(beforeWorkspace);
    runtime.dispose();
  });

  it("does not apply recovery when history metadata generation fails", async () => {
    const runtime = createWorkbenchRuntime(engine(), {
      makeId: () => { throw new Error("History id failed."); },
    });
    const beforeProject = runtime.project.getState();
    const beforeWorkspace = runtime.documents.getState();

    await expect(runtime.dispatch({
      kind: "restore-recovery-confirmed",
      origin: "system",
      expectedProject: beforeProject,
      expectedWorkspace: beforeWorkspace,
      recovery: {
        version: 1,
        projectId: "scratch",
        capturedAt: "2026-07-10T00:00:00.000Z",
        buffers: [{
          documentId: "document-main",
          path: "main.scad",
          source: "cube(77);",
          savedSource: "cube(10);",
        }],
      },
    })).rejects.toThrow("History id failed.");

    expect(runtime.project.getState()).toBe(beforeProject);
    expect(runtime.documents.getState()).toBe(beforeWorkspace);
    runtime.dispose();
  });

  it("schedules auto-render after an atomic scratch recovery", async () => {
    vi.useFakeTimers();
    try {
      const service = engine();
      const runtime = createWorkbenchRuntime(service, {
        rendering: { renderDebounceMs: 25 },
      });
      await runtime.dispatch({ kind: "engine-availability-changed", origin: "system", available: true });
      const beforeProject = runtime.project.getState();
      const beforeWorkspace = runtime.documents.getState();

      await runtime.dispatch({
        kind: "restore-recovery-confirmed",
        origin: "system",
        expectedProject: beforeProject,
        expectedWorkspace: beforeWorkspace,
        recovery: {
          version: 1,
          projectId: "scratch",
          capturedAt: "2026-07-10T00:00:00.000Z",
          buffers: [{
            documentId: "document-main",
            path: "main.scad",
            source: "cube(77);",
            savedSource: "cube(10);",
          }],
        },
      });
      await vi.advanceTimersByTimeAsync(25);

      expect(service.render).toHaveBeenCalledOnce();
      expect(runtime.project.getState()).toBe(beforeProject);
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-renders the selected entry after multi-buffer project recovery", async () => {
    vi.useFakeTimers();
    try {
      const service = engine();
      const runtime = createWorkbenchRuntime(service, {
        rendering: { renderDebounceMs: 25 },
      });
      await runtime.dispatch({ kind: "engine-availability-changed", origin: "system", available: true });
      const beforeProject = runtime.project.getState();
      const beforeWorkspace = runtime.documents.getState();
      const snapshot = createProjectSnapshot("project-a", new Map([
        ["main.scad", "cube(10);"],
        ["parts.scad", "sphere(2);"],
      ]));

      await runtime.dispatch({
        kind: "restore-recovery-confirmed",
        origin: "system",
        expectedProject: beforeProject,
        expectedWorkspace: beforeWorkspace,
        snapshot,
        displayName: "Project A",
        recovery: {
          version: 1,
          projectId: "project-a",
          capturedAt: "2026-07-10T00:00:00.000Z",
          buffers: [
            {
              documentId: "recovered-main",
              path: "main.scad",
              source: "cube(77);",
              savedSource: "cube(10);",
            },
            {
              documentId: "recovered-parts",
              path: "parts.scad",
              source: "sphere(9);",
              savedSource: "sphere(2);",
            },
          ],
        },
      });
      await vi.advanceTimersByTimeAsync(25);

      expect(runtime.documents.getState().documents.find(
        ({ id }) => id === runtime.documents.getState().activeDocumentId,
      )?.path).toBe("main.scad");
      expect(service.render).toHaveBeenCalledWith(expect.objectContaining({
        entryFile: "main.scad",
        files: new Map([
          ["main.scad", "cube(77);"],
          ["parts.scad", "sphere(9);"],
        ]),
      }));
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
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
