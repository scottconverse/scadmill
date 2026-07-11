// @vitest-environment happy-dom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import type { RecoveryPersistence } from "../../../src/application/files/recovery-state";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
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

describe("ProjectLifecycleControls", () => {
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
    expect(view.getByText("cube(20);")).toBeVisible();
    expect(view.getByText("cube(30);")).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Keep my changes" }));

    await waitFor(() => expect(runtime.documents.getState().documents[0]).toMatchObject({
      source: "cube(20);",
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
    const view = render(
      <ProjectLifecycleControls recoveryPersistence={persisted} runtime={runtime} />,
    );

    expect(view.getByRole("alertdialog", { name: "Unsaved work recovery" })).toBeVisible();
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
  });

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
      expect(view.getByRole("alertdialog", { name: "Unsaved work recovery" })).toBeVisible();
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
});
