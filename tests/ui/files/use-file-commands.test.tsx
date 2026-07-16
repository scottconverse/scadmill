// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { isDocumentDirty } from "../../../src/application/documents/document-workspace";
import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  type WorkspaceLayoutState,
} from "../../../src/application/layout/workspace-layout";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { messages } from "../../../src/messages/en";
import { useFileCommands } from "../../../src/ui/files/use-file-commands";

function engine(): EngineService {
  return { render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn() };
}

describe("useFileCommands", () => {
  it("keeps an already visible Files panel open for Open and Export commands", () => {
    const runtime = createWorkbenchRuntime(engine());
    const onLayoutAction = vi.fn();
    const view = renderHook(
      ({ layout, narrow }: { layout: WorkspaceLayoutState; narrow: boolean }) =>
        useFileCommands({
          runtime,
          workspace: runtime.documents.getState(),
          projectMode: runtime.project.getState().mode,
          layout,
          narrow,
          onLayoutAction,
        }),
      { initialProps: { layout: DEFAULT_WORKSPACE_LAYOUT, narrow: false } },
    );

    act(() => view.result.current.openProject());
    act(() => view.result.current.exportModel());

    expect(onLayoutAction).not.toHaveBeenCalled();
    expect(view.result.current.requestedExport).toBe(1);

    view.rerender({
      layout: { ...DEFAULT_WORKSPACE_LAYOUT, maximized: "viewer" },
      narrow: false,
    });
    act(() => view.result.current.openProject());
    expect(onLayoutAction).toHaveBeenLastCalledWith({
      kind: "toggle-maximize",
      region: "viewer",
    });

    onLayoutAction.mockClear();
    view.rerender({
      layout: {
        ...DEFAULT_WORKSPACE_LAYOUT,
        narrowDockOpen: false,
        narrowSheet: "console",
      },
      narrow: true,
    });
    act(() => view.result.current.exportModel());
    expect(onLayoutAction.mock.calls).toEqual([
      [{ kind: "set-narrow-sheet", sheet: null }],
      [{ kind: "activate-rail", panel: "files", narrow: true }],
    ]);
    expect(view.result.current.requestedExport).toBe(2);
  });

  it("surfaces an asynchronous project save rejection and leaves the document dirty", async () => {
    const files = new Map([["main.scad", "cube(10);"]]);
    const storage: ProjectStorage = {
      snapshot: async (projectId) => createProjectSnapshot(projectId, files),
      write: async () => { throw new Error("Disk is read-only"); },
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialProject: createProjectSnapshot("project-a", files),
      projectStorage: storage,
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(20);",
    });
    const view = renderHook(() => useFileCommands({
      runtime,
      workspace: runtime.documents.getState(),
      projectMode: runtime.project.getState().mode,
      layout: DEFAULT_WORKSPACE_LAYOUT,
      narrow: false,
      onLayoutAction: vi.fn(),
    }));

    act(() => view.result.current.save());

    await waitFor(() => expect(view.result.current.notice).toBe(
      messages.fileCommandFailedWithDetail("Disk is read-only"),
    ));
    expect(isDocumentDirty(runtime.documents.getState().documents[0])).toBe(true);
  });

  it("never overwrites the scratch slot for additional tabs or marks them saved", async () => {
    let saved: string | null = null;
    const persistence = {
      load: () => saved,
      save: vi.fn((source: string) => { saved = source; }),
    };
    const runtime = createWorkbenchRuntime(engine(), {
      initialScratchPath: "Untitled",
      initialScratchSource: "",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({ kind: "new-scratch-document", origin: "user" });
    const additional = runtime.documents.getState().activeDocumentId;
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: additional,
      source: "sphere(7);",
    });
    const view = renderHook(() => useFileCommands({
      runtime,
      workspace: runtime.documents.getState(),
      projectMode: runtime.project.getState().mode,
      scratchPersistence: persistence,
      layout: DEFAULT_WORKSPACE_LAYOUT,
      narrow: false,
      onLayoutAction: vi.fn(),
    }));

    expect(view.result.current.saveDisabled).toBe(true);
    expect(view.result.current.saveAllDisabled).toBe(true);
    act(() => view.result.current.saveAll());
    await waitFor(() => expect(view.result.current.notice).toContain(
      messages.scratchSaveAllUnavailable,
    ));
    expect(persistence.save).not.toHaveBeenCalled();
    expect(runtime.documents.getState().documents.every(isDocumentDirty)).toBe(true);

    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    view.rerender();
    expect(view.result.current.saveDisabled).toBe(false);
    act(() => view.result.current.save());
    await waitFor(() => expect(persistence.save).toHaveBeenCalledWith("cube(11);"));
    await waitFor(() => expect(runtime.documents.getState().documents.find(
      ({ id }) => id === "document-main",
    )).toMatchObject({ source: "cube(11);", savedSource: "cube(11);" }));
    expect(runtime.documents.getState().documents.find(
      ({ id }) => id === additional,
    )).toMatchObject({ source: "sphere(7);", savedSource: "" });
    expect(saved).toBe("cube(11);");
  });

  it("formats a dirty OpenSCAD scratch document before saving when enabled", async () => {
    const persistence = { load: vi.fn(() => null), save: vi.fn() };
    const runtime = createWorkbenchRuntime(engine(), {
      initialScratchPath: "Untitled.scad",
      initialScratchSource: "",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "module part(){cube(1);}",
    });
    const view = renderHook(() => useFileCommands({
      formatter: { formatOnSave: true, indentSize: 2 },
      runtime,
      workspace: runtime.documents.getState(),
      projectMode: runtime.project.getState().mode,
      scratchPersistence: persistence,
      layout: DEFAULT_WORKSPACE_LAYOUT,
      narrow: false,
      onLayoutAction: vi.fn(),
    }));

    act(() => view.result.current.save());

    const expected = "module part() {\n  cube(1);\n}";
    await waitFor(() => expect(persistence.save).toHaveBeenCalledWith(expected));
    expect(runtime.documents.getState().documents[0]).toMatchObject({
      savedSource: expected,
      source: expected,
    });
  });

  it("reports format-on-save refusal but still saves malformed source unchanged", async () => {
    const persistence = { load: vi.fn(() => null), save: vi.fn() };
    const source = "module broken( { cube(1);";
    const runtime = createWorkbenchRuntime(engine(), {
      initialScratchPath: "Untitled.scad",
      initialScratchSource: "",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source,
    });
    const view = renderHook(() => useFileCommands({
      formatter: { formatOnSave: true, indentSize: 4 },
      runtime,
      workspace: runtime.documents.getState(),
      projectMode: runtime.project.getState().mode,
      scratchPersistence: persistence,
      layout: DEFAULT_WORKSPACE_LAYOUT,
      narrow: false,
      onLayoutAction: vi.fn(),
    }));

    act(() => view.result.current.save());

    await waitFor(() => expect(view.result.current.notice).toContain(
      "Formatting was not applied because the source contains a syntax error.",
    ));
    expect(persistence.save).toHaveBeenCalledWith(source);
    expect(runtime.documents.getState().documents[0]).toMatchObject({ source, savedSource: source });
  });
});
