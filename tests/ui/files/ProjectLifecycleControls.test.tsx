// @vitest-environment happy-dom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";
import type { RecoveryPersistence } from "../../../src/application/files/recovery-state";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { ExternalChangeDiff } from "../../../src/ui/files/ExternalChangeDiff";
import { ProjectLifecycleControls } from "../../../src/ui/files/ProjectLifecycleControls";

function engine(): EngineService {
  return { render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn() };
}

function storage(files: Map<string, ProjectFileContent>): ProjectStorage {
  return {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    read: async (_projectId, path) => files.get(path),
    write: async (_projectId, path, content) => { files.set(path, content); },
    move: async () => undefined,
    trash: async () => undefined,
    reveal: async () => undefined,
  };
}

function recovery(initial: string | null = null): RecoveryPersistence & { value: string | null } {
  return {
    value: initial,
    load() { return this.value; },
    save(serialized) { this.value = serialized; },
    clear() { this.value = null; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("ProjectLifecycleControls", () => {
  it("accepts or rejects each separated external-change hunk before applying", async () => {
    const unchanged = Array.from({ length: 12 }, (_, index) => `same ${index}`).join("\n");
    const localSource = `start\nlocal one\n${unchanged}\nlocal two\nend`;
    const diskSource = `start\ndisk one\n${unchanged}\ndisk two\nend`;
    const applied = vi.fn();
    const view = render(
      <ExternalChangeDiff
        diskSource={diskSource}
        localSource={localSource}
        onApply={applied}
      />,
    );

    fireEvent.click(view.getByRole("radio", { name: "Inline" }));
    expect(await view.findAllByRole("button", { name: "Use disk change" })).toHaveLength(2);
    fireEvent.click(view.getAllByRole("button", { name: "Use disk change" })[0]);
    fireEvent.click(view.getAllByRole("button", { name: "Keep my change" })[0]);
    const apply = view.getByRole("button", { name: "Apply hunk choices" });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);

    expect(applied).toHaveBeenCalledWith(`start\ndisk one\n${unchanged}\nlocal two\nend`);
  });

  it("inspects a folder, confirms its entry file, opens it, and exposes a reopenable recent item", async () => {
    const files = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["alternate.scad", "sphere(5);"],
    ]);
    const runtime = createWorkbenchRuntime(engine(), {
      projectStorage: storage(files),
      makeId: () => "opened-entry",
    });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={storage(files)}
      />,
    );

    fireEvent.change(view.getByLabelText("Project folder or id"), {
      target: { value: "C:\\models\\cube" },
    });
    fireEvent.click(view.getByRole("button", { name: "Open project" }));
    const entry = await view.findByLabelText("Project entry file");
    fireEvent.change(entry, { target: { value: "alternate.scad" } });
    fireEvent.click(view.getByRole("button", { name: "Confirm project replacement" }));

    await waitFor(() => expect(runtime.project.getState()).toMatchObject({
      mode: "project",
      snapshot: { projectId: "C:\\models\\cube" },
    }));
    expect(runtime.documents.getState().documents[0]).toMatchObject({
      path: "alternate.scad",
      source: "sphere(5);",
    });
    expect(view.getByRole("button", { name: /Reopen cube/u })).toBeVisible();
  });

  it("detects a disk edit and offers reload, keep, and a visible diff", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    const projectStorage = storage(files);
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage,
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(20);",
    });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={projectStorage}
      />,
    );
    files.set("main.scad", "cube(30);");

    globalThis.dispatchEvent(new Event("focus"));
    expect(await view.findByRole("alertdialog", { name: "File changed outside ScadMill" })).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Show diff" }));
    expect(view.getByRole("radio", { name: "Side by side" })).toBeChecked();
    expect(view.getByRole("radio", { name: "Inline" })).not.toBeChecked();
    expect(view.container.querySelectorAll(".cm-mergeView .cm-editor")).toHaveLength(2);

    fireEvent.click(view.getByRole("radio", { name: "Inline" }));
    fireEvent.click(await view.findByRole("button", { name: "Use disk change" }));
    fireEvent.click(view.getByRole("button", { name: "Apply hunk choices" }));

    await waitFor(() => expect(runtime.documents.getState().documents[0]).toMatchObject({
      source: "cube(30);",
      savedSource: "cube(30);",
    }));
  });

  it("invalidates an external-change prompt when its project is replaced", async () => {
    const projects = new Map<string, Map<string, ProjectFileContent>>([
      ["project-a", new Map([["main.scad", "cube(10);"]])],
      ["project-b", new Map([["main.scad", "sphere(5);"]])],
    ]);
    const write = vi.fn(async (projectId: string, path: string, content: ProjectFileContent) => {
      projects.get(projectId)?.set(path, content);
    });
    const projectStorage: ProjectStorage = {
      snapshot: async (projectId) => createProjectSnapshot(
        projectId,
        projects.get(projectId) ?? new Map(),
      ),
      read: async (projectId, path) => projects.get(projectId)?.get(path),
      write,
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", projects.get("project-a") ?? new Map()),
      projectStorage,
    });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={projectStorage}
      />,
    );
    projects.get("project-a")?.delete("main.scad");
    globalThis.dispatchEvent(new Event("focus"));
    expect(await view.findByRole("alertdialog", { name: "File changed outside ScadMill" })).toBeVisible();

    fireEvent.change(view.getByLabelText("Project folder or id"), {
      target: { value: "project-b" },
    });
    fireEvent.click(view.getByRole("button", { name: "Open project" }));
    fireEvent.click(await view.findByRole("button", { name: "Confirm project replacement" }));
    await waitFor(() => expect(runtime.project.getState().snapshot.projectId).toBe("project-b"));
    const staleKeep = view.queryByRole("button", { name: "Keep my changes" });
    if (staleKeep) fireEvent.click(staleKeep);

    await waitFor(() => {
      expect(view.queryByRole("alertdialog", { name: "File changed outside ScadMill" }))
        .not.toBeInTheDocument();
      expect(projects.get("project-b")?.get("main.scad")).toBe("sphere(5);");
      expect(write).not.toHaveBeenCalledWith("project-b", "main.scad", "cube(10);");
    });
  });

  it("polls only open files instead of snapshotting unrelated binary assets", async () => {
    const files = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["assets/large-reference.stl", new Uint8Array(4 * 1024 * 1024)],
    ]);
    const projectStorage = storage(files);
    const snapshot = vi.spyOn(projectStorage, "snapshot");
    const read = vi.spyOn(projectStorage, "read");
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage,
    });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={projectStorage}
      />,
    );
    files.set("main.scad", "cube(20);");

    globalThis.dispatchEvent(new Event("focus"));

    expect(await view.findByRole("alertdialog", { name: "File changed outside ScadMill" })).toBeVisible();
    expect(read).toHaveBeenCalledWith("project-a", "main.scad");
    expect(read).not.toHaveBeenCalledWith("project-a", "assets/large-reference.stl");
    expect(snapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", undefined, false],
    ["renamed", undefined, true],
    ["replaced by binary data", new Uint8Array([0, 255, 1]), false],
  ])("protects local source when an open file is %s", async (_label, diskContent, renamed) => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    const projectStorage = storage(files);
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage,
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(22);",
    });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={projectStorage}
      />,
    );
    if (diskContent === undefined) {
      files.delete("main.scad");
      if (renamed) files.set("renamed.scad", "cube(10);");
    }
    else files.set("main.scad", diskContent);

    globalThis.dispatchEvent(new Event("focus"));

    expect(await view.findByRole("alertdialog", { name: "File changed outside ScadMill" })).toBeVisible();
    expect(view.queryByRole("button", { name: "Reload from disk" })).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Show diff" })).not.toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(files.get("main.scad")).toBe("cube(22);"));
  });

  it("serializes focus checks so a slow read cannot overlap another poll", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let active = 0;
    let maximumActive = 0;
    const delayed = async <T,>(value: T): Promise<T> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await blocked;
      active -= 1;
      return value;
    };
    const projectStorage: ProjectStorage = {
      snapshot: (projectId) => delayed(createProjectSnapshot(projectId, files)),
      read: (_projectId, path) => delayed(files.get(path)),
      write: async () => undefined,
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage,
    });
    render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={projectStorage}
      />,
    );

    globalThis.dispatchEvent(new Event("focus"));
    globalThis.dispatchEvent(new Event("focus"));

    expect(maximumActive).toBe(1);
    await act(async () => {
      release();
      await blocked;
    });
  });

  it("offers and restores an exact unsaved scratch recovery buffer", async () => {
    const persisted = recovery(JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [
        {
          documentId: "document-main",
          path: "main.scad",
          source: "cube(77);",
          savedSource: "cube(12);",
        },
        {
          documentId: "scratch-notes",
          path: "notes.scad",
          source: "sphere(9);",
          savedSource: "sphere(4);",
        },
      ],
    }));
    const runtime = createWorkbenchRuntime(engine());
    const liveEditor = document.createElement("textarea");
    liveEditor.setAttribute("aria-label", "Live editor");
    document.body.append(liveEditor);
    liveEditor.focus();
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );

    const prompt = view.getByRole("region", { name: "Unsaved work recovery" });
    expect(prompt).toBeVisible();
    expect(prompt).not.toHaveAttribute("aria-modal");
    expect(view.queryByRole("alertdialog", { name: "Unsaved work recovery" }))
      .not.toBeInTheDocument();
    expect(liveEditor).toHaveFocus();
    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    await waitFor(() => expect(runtime.documents.getState().documents).toEqual([
      expect.objectContaining({
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }),
      expect.objectContaining({
        path: "notes.scad",
        source: "sphere(9);",
        savedSource: "sphere(4);",
      }),
    ]));
    await waitFor(() => expect(persisted.value).toContain("cube(77);"));
    liveEditor.remove();
  });

  it("restores an opaque browser workspace under its captured display name", async () => {
    const projectId = "workspace:opaque-indexeddb-key";
    const persisted = recovery(JSON.stringify({
      version: 1,
      projectId,
      displayName: "Gear configurator",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "recovered-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    }));
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(12);"]]);
    const projectStorage = storage(files);
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        projectLocatorKind="browser"
        recoveryPersistence={persisted}
        runtime={runtime}
        storage={projectStorage}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    await waitFor(() => expect(runtime.project.getState()).toMatchObject({
      displayName: "Gear configurator",
      recentProjects: [{
        projectId,
        displayName: "Gear configurator",
      }],
    }));
    expect(view.getByRole("button", { name: "Reopen Gear configurator" })).toBeVisible();
    expect(view.queryByRole("button", { name: /workspace:opaque-indexeddb-key/iu }))
      .not.toBeInTheDocument();
    runtime.dispose();
  });

  it("keeps restored dirty buffers continuously durable without clearing recovery first", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "document-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const persisted = recovery(serialized);
    const clear = vi.spyOn(persisted, "clear");
    const runtime = createWorkbenchRuntime(engine());
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    await waitFor(() => expect(runtime.documents.getState().documents[0]).toMatchObject({
      source: "cube(77);",
      savedSource: "cube(12);",
    }));
    await act(async () => { await Promise.resolve(); });
    expect(clear).not.toHaveBeenCalled();
    expect(persisted.value).not.toBeNull();
    runtime.dispose();
  });

  it("atomically restores every text buffer from a project snapshot", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "project-a",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [
        {
          documentId: "recovered-main",
          path: "main.scad",
          source: "cube(77);",
          savedSource: "cube(12);",
        },
        {
          documentId: "recovered-notes",
          path: "notes.scad",
          source: "sphere(9);",
          savedSource: "sphere(4);",
        },
      ],
    });
    const persisted = recovery(serialized);
    const clear = vi.spyOn(persisted, "clear");
    const files = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(12);"],
      ["notes.scad", "sphere(4);"],
    ]);
    const projectStorage = storage(files);
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={persisted}
        runtime={runtime}
        storage={projectStorage}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    await waitFor(() => expect(runtime.documents.getState().documents.map(
      ({ path, source, savedSource }) => ({ path, source, savedSource }),
    )).toEqual([
      { path: "main.scad", source: "cube(77);", savedSource: "cube(12);" },
      { path: "notes.scad", source: "sphere(9);", savedSource: "sphere(4);" },
    ]));
    expect(runtime.project.getState()).toMatchObject({
      mode: "project",
      snapshot: { projectId: "project-a" },
    });
    expect(clear).not.toHaveBeenCalled();
    expect(persisted.value).toBe(serialized);
    runtime.dispose();
  });

  it("preserves edits made while a project recovery snapshot is awaited", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "project-a",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "recovered-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const persisted = recovery(serialized);
    const releaseSnapshot = deferred<void>();
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(12);"]]);
    const projectStorage = storage(files);
    const snapshot = vi.fn(async (projectId: string) => {
      await releaseSnapshot.promise;
      return createProjectSnapshot(projectId, files);
    });
    projectStorage.snapshot = snapshot;
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={persisted}
        runtime={runtime}
        storage={projectStorage}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));
    await waitFor(() => expect(snapshot).toHaveBeenCalledWith("project-a"));
    await act(async () => {
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "sphere(99);",
      });
      releaseSnapshot.resolve();
      await releaseSnapshot.promise;
    });

    await waitFor(() => expect(runtime.documents.getState().documents.map(
      ({ path, source }) => ({ path, source }),
    )).toEqual([
      { path: "main.scad", source: "cube(77);" },
      { path: "main (recovery 2).scad", source: "sphere(99);" },
    ]));
    expect(persisted.value).toContain("sphere(99);");
    runtime.dispose();
  });

  it("aborts project recovery when a clean workspace change occurs during snapshot load", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "project-a",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "recovered-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const persisted = recovery(serialized);
    const releaseSnapshot = deferred<void>();
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(12);"]]);
    const projectStorage = storage(files);
    const snapshot = vi.fn(async (projectId: string) => {
      await releaseSnapshot.promise;
      return createProjectSnapshot(projectId, files);
    });
    projectStorage.snapshot = snapshot;
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={persisted}
        runtime={runtime}
        storage={projectStorage}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));
    await waitFor(() => expect(snapshot).toHaveBeenCalledWith("project-a"));
    await act(async () => {
      await runtime.dispatch({
        kind: "open-document",
        origin: "user",
        document: { id: "clean-notes", path: "notes.scad", source: "sphere(2);" },
      });
      releaseSnapshot.resolve();
      await releaseSnapshot.promise;
    });

    expect(await view.findByText(/workspace changed while restoration was prepared/iu)).toBeVisible();
    expect(runtime.project.getState().mode).toBe("scratch");
    expect(runtime.documents.getState().documents.map(({ path, source }) => ({ path, source })))
      .toEqual([
        { path: "main.scad", source: "cube(10);" },
        { path: "notes.scad", source: "sphere(2);" },
      ]);
    expect(persisted.value).toBe(serialized);
    runtime.dispose();
  });

  it("aborts project recovery when project state changes without changing open documents", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "project-a",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "recovered-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const persisted = recovery(serialized);
    const releaseSnapshot = deferred<void>();
    const recoveredFiles = new Map<string, ProjectFileContent>([["main.scad", "cube(12);"]]);
    const refreshedScratchFiles = new Map<string, ProjectFileContent>([
      ["main.scad", "cube(10);"],
      ["closed.scad", "sphere(3);"],
    ]);
    const snapshot = vi.fn(async (projectId: string) => {
      if (projectId === "project-a") {
        await releaseSnapshot.promise;
        return createProjectSnapshot(projectId, recoveredFiles);
      }
      return createProjectSnapshot(projectId, refreshedScratchFiles);
    });
    const projectStorage: ProjectStorage = {
      snapshot,
      read: async () => undefined,
      write: async () => undefined,
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={persisted}
        runtime={runtime}
        storage={projectStorage}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));
    await waitFor(() => expect(snapshot).toHaveBeenCalledWith("project-a"));
    const workspaceBeforeRefresh = runtime.documents.getState();
    await act(async () => {
      await runtime.dispatch({ kind: "refresh-project", origin: "system" });
      releaseSnapshot.resolve();
      await releaseSnapshot.promise;
    });
    const refreshedProject = runtime.project.getState();

    expect(await view.findByText(/project changed while restoration was prepared/iu)).toBeVisible();
    expect(runtime.project.getState()).toBe(refreshedProject);
    expect(runtime.project.getState().snapshot.files.has("closed.scad" as never)).toBe(true);
    expect(runtime.documents.getState()).toBe(workspaceBeforeRefresh);
    expect(persisted.value).toBe(serialized);
    runtime.dispose();
  });

  it("rejects an unsafe later scratch buffer without changing any workspace state", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [
        {
          documentId: "safe-notes",
          path: "notes.scad",
          source: "sphere(7);",
          savedSource: "sphere(2);",
        },
        {
          documentId: "unsafe-notes",
          path: "../escape.scad",
          source: "cube(9);",
          savedSource: "cube(3);",
        },
      ],
    });
    const persisted = recovery(serialized);
    const runtime = createWorkbenchRuntime(engine());
    const beforeProject = runtime.project.getState();
    const beforeWorkspace = runtime.documents.getState();
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    expect(await view.findByText(/Invalid project path.*escape\.scad/iu)).toBeVisible();
    expect(runtime.project.getState()).toBe(beforeProject);
    expect(runtime.documents.getState()).toBe(beforeWorkspace);
    expect(persisted.value).toBe(serialized);
    runtime.dispose();
  });

  it("allocates a collision-proof scratch document id before restoring", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "taken",
        path: "recovered.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const persisted = recovery(serialized);
    const runtime = createWorkbenchRuntime(engine());
    await runtime.dispatch({
      kind: "open-document",
      origin: "system",
      document: { id: "taken", path: "existing.scad", source: "sphere(1);" },
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "system",
      document: { id: "taken-recovery-2", path: "occupied-2.scad", source: "sphere(2);" },
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "system",
      document: { id: "taken-recovery-3", path: "occupied-3.scad", source: "sphere(3);" },
    });
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    await waitFor(() => expect(runtime.documents.getState().documents).toContainEqual(
      expect.objectContaining({ path: "recovered.scad", source: "cube(77);" }),
    ));
    const ids = runtime.documents.getState().documents.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(runtime.documents.getState().documents.find(({ path }) => path === "recovered.scad")?.id)
      .toBe("taken-recovery-4");
    runtime.dispose();
  });

  it("leaves project and workspace untouched when the atomic recovery dispatch fails", async () => {
    const serialized = JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "recovered-notes",
        path: "notes.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const persisted = recovery(serialized);
    const baseRuntime = createWorkbenchRuntime(engine());
    const runtime = {
      ...baseRuntime,
      dispatch: vi.fn(async (command: Parameters<typeof baseRuntime.dispatch>[0]) => {
        if ((command as { kind: string }).kind === "restore-recovery-confirmed") {
          throw new Error("Simulated recovery transition failure.");
        }
        await baseRuntime.dispatch(command);
      }),
    };
    const beforeProject = runtime.project.getState();
    const beforeWorkspace = runtime.documents.getState();
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    expect(await view.findByText(/Simulated recovery transition failure/u)).toBeVisible();
    expect(runtime.project.getState()).toBe(beforeProject);
    expect(runtime.documents.getState()).toBe(beforeWorkspace);
    expect(persisted.value).toBe(serialized);
    baseRuntime.dispose();
  });

  it.each([
    ["missing", undefined],
    ["binary", new Uint8Array([0, 1, 2])],
  ] satisfies readonly (readonly [string, ProjectFileContent | undefined])[])(
    "retains project recovery when a recovered path is now %s",
    async (_caseName, recoveredContent) => {
      const serialized = JSON.stringify({
        version: 1,
        projectId: "project-a",
        capturedAt: "2026-07-10T00:00:00.000Z",
        buffers: [{
          documentId: "deleted-source",
          path: "deleted.scad",
          source: "cube(77);",
          savedSource: "cube(12);",
        }],
      });
      const persisted = recovery(serialized);
      const files = new Map<string, ProjectFileContent>([["main.scad", "sphere(5);"]]);
      if (recoveredContent !== undefined) files.set("deleted.scad", recoveredContent);
      const projectStorage = storage(files);
      const runtime = createWorkbenchRuntime(engine(), { projectStorage });
      const view = render(
        <ProjectLifecycleControls
          recoveryPersistence={persisted}
          runtime={runtime}
          storage={projectStorage}
        />,
      );

      fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

      expect(await view.findByText(/deleted\.scad.*missing or binary/iu)).toBeVisible();
      expect(view.getByRole("region", { name: "Unsaved work recovery" })).toBeVisible();
      expect(persisted.value).toBe(serialized);
      expect(runtime.project.getState().mode).toBe("scratch");
      runtime.dispose();
    },
  );

  it("preserves pending recovery alongside newer dirty work when ids and paths collide", async () => {
    const persisted = recovery(JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "document-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    }));
    const runtime = createWorkbenchRuntime(engine());
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );

    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "sphere(99);",
    });

    await waitFor(() => {
      const durable = JSON.parse(persisted.value ?? "null") as {
        projectId: string;
        buffers: Array<{ documentId: string; path: string; source: string }>;
      };
      expect(durable.projectId).toBe("scratch");
      expect(durable.buffers.map(({ source }) => source)).toEqual([
        "cube(77);",
        "sphere(99);",
      ]);
      expect(durable.buffers.map(({ documentId }) => documentId)).toEqual([
        "document-main",
        "document-main-recovery-2",
      ]);
      expect(durable.buffers.map(({ path }) => path)).toEqual([
        "main.scad",
        "main (recovery 2).scad",
      ]);
    });

    view.unmount();
    runtime.dispose();
    const restarted = createWorkbenchRuntime(engine());
    const restartedView = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={restarted} />,
    );
    fireEvent.click(restartedView.getByRole("button", { name: "Restore unsaved work" }));
    await waitFor(() => expect(restarted.documents.getState().documents.map(
      ({ path, source }) => ({ path, source }),
    )).toEqual([
      { path: "main.scad", source: "cube(77);" },
      { path: "main (recovery 2).scad", source: "sphere(99);" },
    ]));
    restarted.dispose();
  });

  it("restores pending and newer dirty work in the same session after alongside durability", async () => {
    const persisted = recovery(JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "document-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    }));
    const runtime = createWorkbenchRuntime(engine());
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );
    await act(async () => {
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "sphere(99);",
      });
    });
    await waitFor(() => expect(JSON.parse(persisted.value ?? "null").buffers).toHaveLength(2));

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    await waitFor(() => expect(runtime.documents.getState().documents.map(
      ({ path, source }) => ({ path, source }),
    )).toEqual([
      { path: "main.scad", source: "cube(77);" },
      { path: "main (recovery 2).scad", source: "sphere(99);" },
    ]));
    expect(JSON.parse(persisted.value ?? "null").buffers.map(
      ({ source }: { source: string }) => source,
    )).toEqual(["cube(77);", "sphere(99);"]);
    runtime.dispose();
  });

  it("combines the latest dirty work when Restore is clicked before the debounce", async () => {
    const persisted = recovery(JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "document-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    }));
    const runtime = createWorkbenchRuntime(engine());
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );
    await act(async () => {
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "sphere(101);",
      });
    });

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    await waitFor(() => expect(runtime.documents.getState().documents.map(
      ({ path, source }) => ({ path, source }),
    )).toEqual([
      { path: "main.scad", source: "cube(77);" },
      { path: "main (recovery 2).scad", source: "sphere(101);" },
    ]));
    expect(JSON.parse(persisted.value ?? "null").buffers.map(
      ({ source }: { source: string }) => source,
    )).toEqual(["cube(77);", "sphere(101);"]);
    runtime.dispose();
  });

  it("keeps durable recovery and live work when click-time combination exceeds the limit", async () => {
    const durable = JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "document-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const persisted = recovery(durable);
    const runtime = createWorkbenchRuntime(engine());
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );
    const latestSource = "x".repeat(4 * 1024 * 1024 + 1);
    await act(async () => {
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: latestSource,
      });
    });

    fireEvent.click(view.getByRole("button", { name: "Restore unsaved work" }));

    expect(await view.findByText(/4 MiB recovery limit/u)).toBeVisible();
    expect(view.getByRole("region", { name: "Unsaved work recovery" })).toBeVisible();
    expect(runtime.documents.getState().documents[0]?.source).toBe(latestSource);
    expect(persisted.value).toBe(durable);
    runtime.dispose();
  });

  it("coalesces rapid recovery captures and persists only the latest source", async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn();
      const persisted: RecoveryPersistence = {
        load: () => null,
        save,
        clear: vi.fn(),
      };
      const runtime = createWorkbenchRuntime(engine());
      const view = render(
        <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
      );

      await act(async () => {
        await runtime.dispatch({
          kind: "edit-document",
          origin: "user",
          documentId: "document-main",
          source: "cube(11);",
        });
        await runtime.dispatch({
          kind: "edit-document",
          origin: "user",
          documentId: "document-main",
          source: "cube(12);",
        });
      });

      expect(save).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(save).toHaveBeenCalledOnce();
      expect(save.mock.calls[0]?.[0]).toContain("cube(12);");
      view.unmount();
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears stale recovery immediately once the workspace is clean", () => {
    vi.useFakeTimers();
    try {
      const clear = vi.fn();
      const persisted: RecoveryPersistence = {
        load: () => null,
        save: vi.fn(),
        clear,
      };
      const runtime = createWorkbenchRuntime(engine());

      const view = render(
        <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
      );

      expect(clear).toHaveBeenCalledOnce();
      view.unmount();
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["form", "recent", "requested"] as const)(
    "blocks the %s project-open path while crash recovery is pending",
    async (openPath) => {
      const files = new Map<string, ProjectFileContent>([["main.scad", "sphere(5);"]]);
      const snapshot = vi.fn(async (projectId: string) => createProjectSnapshot(projectId, files));
      const projectStorage: ProjectStorage = {
        snapshot,
        read: async (_projectId, path) => files.get(path),
        write: async (_projectId, path, content) => { files.set(path, content); },
        move: async () => undefined,
        trash: async () => undefined,
        reveal: async () => undefined,
      };
      const runtime = createWorkbenchRuntime(engine(), {
        projectStorage,
        recentProjectsPersistence: {
          load: () => [{
            projectId: "project-b",
            displayName: "Project B",
            openedAt: "2026-07-10T00:00:00.000Z",
          }],
          save: () => undefined,
        },
      });
      const persisted = recovery(JSON.stringify({
        version: 1,
        projectId: "scratch",
        capturedAt: "2026-07-10T00:00:00.000Z",
        buffers: [{
          documentId: "document-main",
          path: "main.scad",
          source: "cube(77);",
          savedSource: "cube(12);",
        }],
      }));
      const requestedProject = openPath === "requested"
        ? { sequence: 1, projectId: "project-b", displayName: "Project B" }
        : undefined;
      const view = render(
        <ProjectLifecycleControls
          recoveryPersistence={persisted}
          requestedProject={requestedProject}
          runtime={runtime}
          storage={projectStorage}
        />,
      );

      if (openPath === "form") {
        fireEvent.change(view.getByLabelText("Project folder or id"), {
          target: { value: "project-b" },
        });
        fireEvent.click(view.getByRole("button", { name: "Open project" }));
      } else if (openPath === "recent") {
        fireEvent.click(view.getByRole("button", { name: "Reopen Project B" }));
      }
      await act(async () => { await Promise.resolve(); });

      expect(snapshot).not.toHaveBeenCalledWith("project-b");
      expect(view.queryByRole("dialog", { name: "Confirm project replacement" }))
        .not.toBeInTheDocument();
      expect(view.getByRole("region", { name: "Unsaved work recovery" })).toBeVisible();
      expect(runtime.project.getState().mode).toBe("scratch");
    },
  );

  it("does not confirm destructive project replacement while any tab is dirty", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(10);"]]);
    const projectStorage = storage(files);
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(99);",
    });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={projectStorage}
      />,
    );
    fireEvent.change(view.getByLabelText("Project folder or id"), {
      target: { value: "project-b" },
    });
    fireEvent.click(view.getByRole("button", { name: "Open project" }));

    const confirm = await view.findByRole("button", { name: "Confirm project replacement" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(runtime.project.getState().mode).toBe("scratch");
  });

  it("opens an empty folder by letting the user create its first source file", async () => {
    const files = new Map<string, ProjectFileContent>();
    const projectStorage = storage(files);
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        recoveryPersistence={recovery()}
        runtime={runtime}
        storage={projectStorage}
      />,
    );
    fireEvent.change(view.getByLabelText("Project folder or id"), {
      target: { value: "empty-project" },
    });
    fireEvent.click(view.getByRole("button", { name: "Open project" }));

    const firstFile = await view.findByLabelText("First project source file");
    fireEvent.change(firstFile, { target: { value: "design.scad" } });
    fireEvent.click(view.getByRole("button", { name: "Confirm project replacement" }));

    await waitFor(() => expect(files.get("design.scad")).toBe(""));
    expect(runtime.project.getState()).toMatchObject({ mode: "project", displayName: "empty-project" });
    expect(runtime.documents.getState().documents[0].path).toBe("design.scad");
  });

  it("creates a named browser workspace without exposing or reusing its opaque identity", async () => {
    const projects = new Map<string, Map<string, ProjectFileContent>>([
      ["workspace:existing-empty", new Map()],
    ]);
    const projectStorage: ProjectStorage = {
      snapshot: async (projectId) => createProjectSnapshot(
        projectId,
        projects.get(projectId) ?? new Map(),
      ),
      read: async (projectId, path) => projects.get(projectId)?.get(path),
      write: async (projectId, path, content) => {
        const files = projects.get(projectId) ?? new Map<string, ProjectFileContent>();
        files.set(path, content);
        projects.set(projectId, files);
      },
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const workspaceDirectory = {
      listWorkspaces: vi.fn(async () => [{
        projectId: "workspace:existing-empty",
        displayName: "Existing Empty",
      }]),
      createWorkspace: vi.fn(async (displayName: string) => {
        projects.set("workspace:opaque-new", new Map([["main.scad", ""]]));
        return { projectId: "workspace:opaque-new", displayName };
      }),
    };
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        projectLocatorKind="browser"
        runtime={runtime}
        storage={projectStorage}
        workspaceDirectory={workspaceDirectory}
      />,
    );

    expect(view.queryByRole("button", { name: "Create workspace" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Create workspace" }));
    fireEvent.change(view.getByLabelText("Workspace name"), {
      target: { value: "Gear Lab" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create and open workspace" }));
    fireEvent.click(await view.findByRole("button", { name: "Confirm project replacement" }));

    await waitFor(() => expect(runtime.project.getState()).toMatchObject({
      mode: "project",
      displayName: "Gear Lab",
      snapshot: { projectId: "workspace:opaque-new" },
    }));
    expect(workspaceDirectory.createWorkspace).toHaveBeenCalledWith("Gear Lab");
    expect(projects.get("workspace:existing-empty")).toEqual(new Map());
    expect(view.queryByText("workspace:opaque-new")).not.toBeInTheDocument();
  });

  it("opens discoverable existing and recent browser workspaces by name", async () => {
    const projects = new Map<string, Map<string, ProjectFileContent>>([
      ["workspace:opaque-existing", new Map([["main.scad", "cube(3);"]])],
      ["workspace:opaque-recent", new Map([["main.scad", "sphere(4);"]])],
    ]);
    const projectStorage: ProjectStorage = {
      snapshot: async (projectId) => createProjectSnapshot(
        projectId,
        projects.get(projectId) ?? new Map(),
      ),
      read: async (projectId, path) => projects.get(projectId)?.get(path),
      write: async () => undefined,
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine(), {
      projectStorage,
      recentProjectsPersistence: {
        load: () => [{
          projectId: "workspace:opaque-recent",
          displayName: "Recent Wheel",
          openedAt: "2026-07-11T00:00:00.000Z",
        }],
        save: () => undefined,
      },
    });
    const view = render(
      <ProjectLifecycleControls
        projectLocatorKind="browser"
        runtime={runtime}
        storage={projectStorage}
        workspaceDirectory={{
          listWorkspaces: async () => [{
            projectId: "workspace:opaque-existing",
            displayName: "Existing Gear",
          }],
          createWorkspace: async () => {
            throw new Error("not used");
          },
        }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Open workspace" }));
    fireEvent.click(await view.findByRole("button", { name: "Open Existing Gear" }));
    fireEvent.click(await view.findByRole("button", { name: "Confirm project replacement" }));
    await waitFor(() => expect(runtime.project.getState().displayName).toBe("Existing Gear"));

    expect(view.getByRole("button", { name: "Reopen Recent Wheel" })).toBeVisible();
    expect(view.queryByText("workspace:opaque-existing")).not.toBeInTheDocument();
    expect(view.queryByText("workspace:opaque-recent")).not.toBeInTheDocument();
  });

  it("uses a desktop folder picker, treats cancel as no-op, and reports picker failure", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(6);"]]);
    const snapshot = vi.fn(async (projectId: string) => createProjectSnapshot(projectId, files));
    const projectStorage: ProjectStorage = {
      snapshot,
      read: async (_projectId, path) => files.get(path),
      write: async () => undefined,
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const chooseDirectory = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("Native dialog denied"))
      .mockResolvedValueOnce({ projectId: "C:\\Models\\Gear", displayName: "Gear" });
    const runtime = createWorkbenchRuntime(engine(), { projectStorage });
    const view = render(
      <ProjectLifecycleControls
        directoryPicker={{ chooseDirectory }}
        projectLocatorKind="folder"
        runtime={runtime}
        storage={projectStorage}
      />,
    );

    const choose = view.getByRole("button", { name: "Choose folder…" });
    fireEvent.click(choose);
    await waitFor(() => expect(chooseDirectory).toHaveBeenCalledTimes(1));
    expect(snapshot).not.toHaveBeenCalled();
    expect(runtime.project.getState().mode).toBe("scratch");

    fireEvent.click(choose);
    expect(await view.findByRole("alert")).toHaveTextContent("Native dialog denied");
    expect(runtime.project.getState().mode).toBe("scratch");

    fireEvent.click(choose);
    fireEvent.click(await view.findByRole("button", { name: "Confirm project replacement" }));
    await waitFor(() => expect(runtime.project.getState()).toMatchObject({
      mode: "project",
      displayName: "Gear",
      snapshot: { projectId: "C:\\Models\\Gear" },
    }));
  });

  it("blocks workspace creation for dirty tabs and native picking during recovery", async () => {
    const files = new Map<string, ProjectFileContent>();
    const projectStorage = storage(files);
    const dirtyRuntime = createWorkbenchRuntime(engine(), { projectStorage });
    await dirtyRuntime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(99);",
    });
    const createWorkspace = vi.fn(async () => ({
      projectId: "workspace:unused",
      displayName: "Unused",
    }));
    const browser = render(
      <ProjectLifecycleControls
        projectLocatorKind="browser"
        runtime={dirtyRuntime}
        storage={projectStorage}
        workspaceDirectory={{ listWorkspaces: async () => [], createWorkspace }}
      />,
    );
    fireEvent.click(browser.getByRole("button", { name: "Create workspace" }));
    expect(browser.getByLabelText("Workspace name")).toBeDisabled();
    expect(browser.getByRole("button", { name: "Create and open workspace" })).toBeDisabled();
    expect(createWorkspace).not.toHaveBeenCalled();

    const chooseDirectory = vi.fn();
    const desktop = render(
      <ProjectLifecycleControls
        directoryPicker={{ chooseDirectory }}
        projectLocatorKind="folder"
        recoveryPersistence={recovery(JSON.stringify({
          version: 1,
          projectId: "scratch",
          capturedAt: "2026-07-11T00:00:00.000Z",
          buffers: [{
            documentId: "document-main",
            path: "main.scad",
            source: "cube(77);",
            savedSource: "cube(12);",
          }],
        }))}
        runtime={createWorkbenchRuntime(engine(), { projectStorage })}
        storage={projectStorage}
      />,
    );
    const choose = desktop.getByRole("button", { name: "Choose folder…" });
    expect(choose).toBeDisabled();
    fireEvent.click(choose);
    expect(chooseDirectory).not.toHaveBeenCalled();
  });
});
