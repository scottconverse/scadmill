// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { isDocumentDirty } from "../../../src/application/documents/document-workspace";
import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { messages } from "../../../src/messages/en";
import { useFileCommands } from "../../../src/ui/files/use-file-commands";

function engine(): EngineService {
  return { render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn() };
}

describe("useFileCommands", () => {
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
});
