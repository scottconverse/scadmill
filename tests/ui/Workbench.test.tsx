// @vitest-environment happy-dom
import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { isDocumentDirty } from "../../src/application/documents/document-workspace";
import type { EngineService, RenderSuccess3D } from "../../src/application/engine/contracts";
import type { ProjectStorage } from "../../src/application/files/project-file-service";
import { createProjectSnapshot } from "../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { messages } from "../../src/messages/en";
import { Workbench } from "../../src/ui/Workbench";

function oneTriangleStl(): Uint8Array {
  const bytes = new Uint8Array(134);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  const vertices = [[0, 0, 0], [10, 0, 0], [10, 10, 10]];
  vertices.flat().forEach((coordinate, index) => {
    view.setFloat32(96 + index * 4, coordinate, true);
  });
  return bytes;
}

describe("Workbench", () => {
  it("feeds the active C6 project snapshot into cross-file completion", async () => {
    const engine: EngineService = {
      render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    const main = "include <lib/shapes.scad>\nbr";
    await runtime.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot: createProjectSnapshot("completion-project", new Map<string, string | Uint8Array>([
        ["main.scad", main],
        ["lib/shapes.scad", "module bracket(size = 12) { cube(size); }"],
        ["assets/logo.png", Uint8Array.of(137, 80, 78, 71)],
      ])),
      displayName: "Completion project",
      entryFile: "main.scad",
    });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2026.06.12"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const content = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered from its DOM.");
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });

    expect(startCompletion(editor)).toBe(true);
    await waitFor(() => expect(completionStatus(editor.state)).toBe("active"));
    expect(currentCompletions(editor.state)).toContainEqual(expect.objectContaining({
      label: "bracket",
      detail: "bracket(size = 12)",
    }));
  });

  it("exposes the default-on automatic render toggle", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "auto-toggle" });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const toggle = within(view.container).getByRole("checkbox", { name: messages.autoRender });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => expect(runtime.settings.getState().autoRender).toBe(false));
    expect(toggle).not.toBeChecked();
  });

  it("routes editor shortcuts through the shared command bus", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "editor-shortcut" });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const content = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });

    fireEvent.keyDown(content, { key: "/", ctrlKey: true });

    await waitFor(() => expect(runtime.history.getState()).toContainEqual(
      expect.objectContaining({
        commandId: "editor-shortcut",
        kind: "editor-command",
        summary: "Editor command: toggle-comment",
      }),
    ));
  });

  it("routes every global File shortcut through the Workbench coordinator", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const scratchPersistence = {
      load: vi.fn(() => null),
      save: vi.fn(),
    };
    let nextId = 0;
    const runtime = createWorkbenchRuntime(engine, {
      initialScratchPath: "Untitled.scad",
      initialScratchSource: "cube(10);",
      makeId: () => {
        nextId += 1;
        return `file-shortcut-${nextId}`;
      },
    });
    const view = render(
      <Workbench
        engine={engine}
        runtime={runtime}
        scratchAutosavePersistence={scratchPersistence}
        engineLabel="OpenSCAD 2026.06.12"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    await act(async () => runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    }));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(scratchPersistence.save).toHaveBeenLastCalledWith("cube(11);");
    await waitFor(() => expect(isDocumentDirty(runtime.documents.getState().documents[0])).toBe(false));

    await act(async () => runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(12);",
    }));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, altKey: true });
    expect(scratchPersistence.save).toHaveBeenCalledTimes(2);
    expect(scratchPersistence.save).toHaveBeenLastCalledWith("cube(12);");
    await waitFor(() => expect(isDocumentDirty(runtime.documents.getState().documents[0])).toBe(false));

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    await waitFor(() => expect(runtime.documents.getState().documents).toHaveLength(2));

    fireEvent.click(workbench.getByRole("button", { name: "Search" }));
    await workbench.findByRole("region", { name: "Search panel" });
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => expect(runtime.layout.getState().activeRail).toBe("files"));
    expect(await workbench.findByRole("region", { name: messages.projectFiles })).toBeVisible();

    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(await workbench.findByRole("dialog", { name: /^Export /u })).toBeVisible();
  });

  it("routes Mod+O and File Open through the native directory picker without mutating on cancel", async () => {
    const engine: EngineService = {
      render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const files = new Map([["main.scad", "cube(8);"]]);
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
      .mockResolvedValueOnce({ projectId: "C:\\Models\\Gear", displayName: "Gear" })
      .mockRejectedValueOnce(new Error("Dialog service unavailable"));
    const runtime = createWorkbenchRuntime(engine, { projectStorage });
    const view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        directoryPicker={{ chooseDirectory }}
        engineLabel="OpenSCAD 2026.06.12"
        projectStorage={projectStorage}
        runtime={runtime}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => expect(chooseDirectory).toHaveBeenCalledTimes(1));
    expect(snapshot).not.toHaveBeenCalled();
    expect(runtime.project.getState().mode).toBe("scratch");

    fireEvent.click(workbench.getByRole("button", { name: messages.fileMenu }));
    fireEvent.click(within(workbench.getByRole("group", {
      name: messages.fileMenu,
    })).getByRole("button", { name: messages.openProject }));
    fireEvent.click(await workbench.findByRole("button", {
      name: messages.confirmProjectReplacement,
    }));
    await waitFor(() => expect(runtime.project.getState()).toMatchObject({
      mode: "project",
      displayName: "Gear",
      snapshot: { projectId: "C:\\Models\\Gear" },
    }));

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(await workbench.findByText(/Dialog service unavailable/u)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(runtime.project.getState().snapshot.projectId).toBe("C:\\Models\\Gear");
  });

  it("switches document tabs without dirtying them and targets the first real editor change", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "document-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);
    const mainTab = workbench.getByRole("tab", { name: "main.scad" });
    const wheelTab = workbench.getByRole("tab", { name: "wheel.scad" });

    expect(mainTab).toHaveAttribute("aria-selected", "true");
    expect(workbench.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", mainTab.id);
    fireEvent.click(wheelTab);
    await waitFor(() => expect(wheelTab).toHaveAttribute("aria-selected", "true"));

    const content = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered.");
    expect(editor.state.doc.toString()).toBe("cylinder(r = 4, h = 2);");
    expect(runtime.documents.getState().documents.map(({ revision }) => revision)).toEqual([0, 0]);

    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: "cylinder(r = 5, h = 2);" },
    });

    expect(
      await workbench.findByRole("tab", { name: messages.documentTabUnsaved("wheel.scad") }),
    ).toHaveAttribute("aria-selected", "true");
    expect(runtime.documents.getState().documents.map(({ id, revision }) => ({ id, revision }))).toEqual([
      { id: "document-main", revision: 0 },
      { id: "document-wheel", revision: 1 },
    ]);
  });

  it("restores a document editor session after switching away and back", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "session-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);
    const firstContent = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    const firstEditor = EditorView.findFromDOM(firstContent);
    if (!firstEditor) throw new Error("CodeMirror view could not be recovered.");
    firstEditor.dispatch({
      changes: { from: 5, to: 7, insert: "11" },
      selection: { anchor: 4 },
    });
    await waitFor(() => expect(runtime.documents.getState().documents[0].source).toBe("cube(11);"));

    fireEvent.click(workbench.getByRole("tab", { name: "wheel.scad" }));
    fireEvent.click(workbench.getByRole("tab", { name: messages.documentTabUnsaved("main.scad") }));
    const restoredContent = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node || node === firstContent) throw new Error("The restored editor has not mounted.");
      return node;
    });
    const restoredEditor = EditorView.findFromDOM(restoredContent);
    if (!restoredEditor) throw new Error("Restored CodeMirror view could not be recovered.");
    expect(restoredEditor.state.doc.toString()).toBe("cube(11);");
    expect(restoredEditor.state.selection.main.head).toBe(4);

    restoredEditor.focus();
    fireEvent.keyDown(restoredContent, { key: "z", ctrlKey: true });
    await waitFor(() => expect(restoredEditor.state.doc.toString()).toBe("cube(10);"));
    expect(runtime.documents.getState().documents[0].source).toBe("cube(10);");
    expect(workbench.getByRole("tab", { name: "main.scad" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      workbench.getByRole("button", { name: messages.closeDocument("main.scad") }),
    ).toBeEnabled();
  });

  it("wires clean close, reopen, reorder, and tab-cycle controls through the command bus", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "document-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    fireEvent.click(workbench.getByRole("button", { name: messages.fileMenu }));
    fireEvent.click(workbench.getByRole("button", { name: messages.closeTab }));
    await waitFor(() => {
      expect(runtime.documents.getState().documents.map(({ id }) => id)).toEqual(["document-wheel"]);
    });

    fireEvent.click(workbench.getByRole("button", { name: messages.fileMenu }));
    fireEvent.click(workbench.getByRole("button", { name: messages.reopenClosedTab }));
    await waitFor(() => {
      expect(runtime.documents.getState().documents.map(({ id }) => id)).toEqual([
        "document-main",
        "document-wheel",
      ]);
    });

    const activeEditor = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    activeEditor.focus();
    expect(activeEditor).toHaveFocus();
    const nextTab = new KeyboardEvent("keydown", {
      key: "Tab",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(nextTab);
    await waitFor(() => expect(runtime.documents.getState().activeDocumentId).toBe("document-wheel"));
    expect(nextTab.defaultPrevented).toBe(true);
    await waitFor(() => expect(workbench.getByRole("tab", { name: "wheel.scad" })).toHaveFocus());

    const wheelTab = workbench.getByRole("tab", { name: "wheel.scad" });
    const mainTab = workbench.getByRole("tab", { name: "main.scad" });
    fireEvent.dragStart(wheelTab);
    fireEvent.dragOver(mainTab);
    fireEvent.drop(mainTab);
    await waitFor(() => {
      expect(runtime.documents.getState().documents.map(({ id }) => id)).toEqual([
        "document-wheel",
        "document-main",
      ]);
    });

    const closeMain = workbench.getByRole("button", { name: messages.closeDocument("main.scad") });
    closeMain.focus();
    fireEvent.click(closeMain);
    await waitFor(() => {
      expect(runtime.documents.getState().documents.map(({ id }) => id)).toEqual(["document-wheel"]);
    });
    expect(workbench.getByRole("tab", { name: "wheel.scad" })).toHaveFocus();
  });

  it("keeps a late render identified with its source tab instead of presenting it as active", async () => {
    const result: RenderSuccess3D = {
      kind: "3d",
      mesh: { format: "stl-binary", bytes: oneTriangleStl() },
      stats: {
        triangles: 1,
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        engineTimeMs: 12,
      },
      diagnostics: [],
      rawLog: "rendered",
    };
    let resolveRender!: (value: RenderSuccess3D) => void;
    const done = new Promise<RenderSuccess3D>((resolve) => {
      resolveRender = resolve;
    });
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({ jobId: "render-main", done }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "document-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    fireEvent.click(
      within(view.container.querySelector(".titlebar") as HTMLElement).getByRole("button", {
        name: messages.renderPreview,
      }),
    );
    await waitFor(() => expect(runtime.render.getState()).toMatchObject({
      status: "rendering",
      documentId: "document-main",
    }));
    fireEvent.click(workbench.getByRole("tab", { name: "wheel.scad" }));
    await waitFor(() => expect(runtime.documents.getState().activeDocumentId).toBe("document-wheel"));
    await act(async () => resolveRender(result));

    expect(await workbench.findByText("Rendered main.scad (3d)")).toBeVisible();
    expect(workbench.queryByText(messages.previewQuality)).not.toBeInTheDocument();
    expect(workbench.queryByText("10 × 10 × 10 mm")).not.toBeInTheDocument();
    expect(within(view.container.querySelector("footer") as HTMLElement).getByText(
      messages.noCurrentDiagnosticsStatus("parts/wheel.scad"),
    )).toBeVisible();

    fireEvent.click(workbench.getByRole("tab", { name: "main.scad" }));
    expect(await workbench.findByText(messages.previewQuality)).toBeVisible();
    expect(workbench.getByText("10 × 10 × 10 mm")).toBeVisible();
  });

  it("marks a render stale and withholds its geometry after the source revision changes", async () => {
    const result: RenderSuccess3D = {
      kind: "3d",
      mesh: { format: "stl-binary", bytes: oneTriangleStl() },
      stats: {
        triangles: 1,
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        engineTimeMs: 12,
      },
      diagnostics: [
        {
          severity: "error",
          message: "Old parser error in file main.scad, line 1",
          file: "main.scad",
          line: 1,
        },
      ],
      rawLog: "ERROR: Old parser error in file main.scad, line 1",
    };
    let resolveRender!: (value: RenderSuccess3D) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-revision-zero",
        done: new Promise<RenderSuccess3D>((resolve) => {
          resolveRender = resolve;
        }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);
    const pending = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    resolveRender(result);
    await act(async () => pending);

    expect(await workbench.findByText("Rendered main.scad (3d, stale)")).toBeVisible();
    expect(workbench.queryByText(messages.previewQuality)).not.toBeInTheDocument();
    expect(workbench.queryByText("10 × 10 × 10 mm")).not.toBeInTheDocument();
    expect(within(view.container.querySelector("footer") as HTMLElement).getByText(
      messages.noCurrentDiagnosticsStatus("main.scad"),
    )).toBeVisible();
    expect(view.container.querySelector(".cm-lintRange-error")).not.toBeInTheDocument();
  });

  it("binds the C0 layout shell to the command-bus layout store", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "layout-command" });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    expect(workbench.getByRole("navigation", { name: "Application menu" })).toBeVisible();
    expect(workbench.getByRole("navigation", { name: "Activity rail" })).toBeVisible();
    expect(workbench.getByRole("region", { name: "Files panel" })).toBeVisible();
    expect(workbench.getByRole("region", { name: "Parameters" })).toBeVisible();
    expect(view.container.querySelector(".workspace-console")).toHaveAttribute("hidden");
    expect(workbench.getAllByRole("separator")).toHaveLength(3);

    fireEvent.click(workbench.getByRole("button", { name: "Search" }));

    expect(await workbench.findByRole("region", { name: "Search panel" })).toBeVisible();
    expect(runtime.layout.getState()).toMatchObject({ activeRail: "search", dockOpen: true });
    expect(runtime.history.getState().at(-1)).toMatchObject({
      kind: "update-layout",
      summary: "Activate search rail",
    });
  });

  it("reports rejected parameter commands without an unhandled promise", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "parameter-command" });
    for (const name of ["existing", "selected"]) {
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "save-set", documentId: "document-main", name },
      });
    }
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2026.06.12"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    fireEvent.change(workbench.getByLabelText(messages.parameterSetName), {
      target: { value: "existing" },
    });
    fireEvent.click(workbench.getByRole("button", { name: messages.renameParameterSet }));

    const alert = await workbench.findByText(
      messages.parameterCommandFailed(messages.unknownParameterCommandError),
    );
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).not.toHaveTextContent(/already exists/i);
    expect(runtime.parameters.getState().documents.get("document-main")?.sets.map(({ name }) => name))
      .toEqual(["existing", "selected"]);
  });

  it("routes global C0 shortcuts and visible collapse controls through the command bus", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "layout-command" });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    const toggleDock = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(toggleDock);
    await waitFor(() => expect(runtime.layout.getState().dockOpen).toBe(false));
    expect(toggleDock.defaultPrevented).toBe(true);

    const statusConsole = within(
      view.container.querySelector("footer") as HTMLElement,
    ).getByRole("button", {
      name: messages.focusConsoleStatus(messages.noCurrentDiagnosticsStatus("main.scad")),
    });
    const collapseEditor = workbench.getByRole("button", { name: "Collapse editor" });
    collapseEditor.focus();
    fireEvent.click(collapseEditor);
    await waitFor(() => expect(runtime.layout.getState().editorOpen).toBe(false));
    await waitFor(() => expect(statusConsole).toHaveFocus());

    const collapseViewer = workbench.getByRole("button", { name: "Collapse viewer" });
    collapseViewer.focus();
    fireEvent.click(collapseViewer);
    await waitFor(() => expect(runtime.layout.getState().viewerOpen).toBe(false));
    await waitFor(() => expect(statusConsole).toHaveFocus());

    fireEvent.click(
      statusConsole,
    );
    await waitFor(() => expect(runtime.layout.getState().consoleOpen).toBe(true));
    await waitFor(() => expect(
      workbench.getByRole("region", { name: messages.consoleRegion }),
    ).toHaveFocus());
  });

  it("keeps honest diagnostics, cursor, and theme controls in the status bar", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "command-1" });
    const customTheme = {
      ...SHIPPED_THEMES[0],
      meta: { name: "Workshop blue", kind: "dark" as const, version: 1 as const },
    };

    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        customThemes={[customTheme]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );

    const workbench = within(view.container);
    expect(workbench.getByRole("combobox", { name: "Theme" }).closest("footer")).toHaveClass(
      "statusbar",
    );
    expect(workbench.getByRole("option", { name: "Workshop blue" })).toBeVisible();
    expect(workbench.getByRole("button", { name: messages.openSettings })).toBeVisible();
    expect(workbench.getByText(messages.noCurrentDiagnosticsStatus("main.scad"))).toBeVisible();
    expect(workbench.getByText("Ln 1, Col 1")).toBeVisible();

    const content = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    const editorView = EditorView.findFromDOM(content);
    if (!editorView) throw new Error("CodeMirror view could not be recovered.");
    editorView.dispatch({ selection: { anchor: 5 } });
    await waitFor(() => expect(workbench.getByText("Ln 1, Col 6")).toBeVisible());
  });

  it("reports structured render diagnostics in the console status chip", async () => {
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-failure",
        done: Promise.resolve({
          kind: "failure",
          reason: "engine-error",
          diagnostics: [
            { severity: "error", message: "Parser error" },
            { severity: "warning", message: "Deprecated form" },
          ],
          rawLog: "Parser error\nDeprecated form\nraw compiler footer",
        }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const titlebar = within(view.container.querySelector(".titlebar") as HTMLElement);

    fireEvent.click(titlebar.getByRole("button", { name: "Render preview" }));

    const status = within(view.container.querySelector("footer") as HTMLElement);
    expect(
      await status.findByRole("button", {
        name: "Focus console: 1 error, 1 warning",
      }),
    ).toBeVisible();
    const consoleRegion = within(view.container).getByRole("region", { name: "Console" });
    expect(consoleRegion).toBeVisible();
    expect(within(consoleRegion).getByText("Parser error", {
      selector: '[data-severity="error"]',
    })).toBeVisible();
    expect(within(consoleRegion).getByText("Deprecated form", {
      selector: '[data-severity="warning"]',
    })).toBeVisible();
    expect(within(consoleRegion).getByText(/raw compiler footer/u)).toBeVisible();
    expect(within(consoleRegion).queryByText("No diagnostics from this session.")).not.toBeInTheDocument();
  });

  it("activates an open diagnostic file and moves the editor cursor to its reported line", async () => {
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-cross-file-diagnostic",
        done: Promise.resolve({
          kind: "failure",
          reason: "engine-error",
          diagnostics: [
            {
              severity: "error",
              message: "Parser error in file parts/wheel.scad, line 2",
              file: "parts/wheel.scad",
              line: 2,
            },
          ],
          rawLog: "ERROR: Parser error in file parts/wheel.scad, line 2",
        }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "diagnostic-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "radius = 4;\ncylinder(r = radius, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    fireEvent.click(
      within(view.container.querySelector(".titlebar") as HTMLElement).getByRole("button", {
        name: messages.renderPreview,
      }),
    );
    const diagnostic = await workbench.findByRole("button", {
      name: messages.goToDiagnostic(
        "Parser error in file parts/wheel.scad, line 2",
        "parts/wheel.scad",
        2,
      ),
    });
    fireEvent.click(diagnostic);

    await waitFor(() => {
      expect(runtime.documents.getState().activeDocumentId).toBe("document-wheel");
      expect(workbench.getByRole("tab", { name: "wheel.scad" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });
    const content = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered.");
    await waitFor(() => {
      expect(editor.state.doc.lineAt(editor.state.selection.main.head).number).toBe(2);
      expect(workbench.getByText("Ln 2, Col 1")).toBeVisible();
      expect(content).toHaveFocus();
      expect(view.container.querySelectorAll(".cm-lintRange-error")).toHaveLength(1);
    });
  });

  it("omits wide-only collapse and maximize controls from narrow mode", () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const view = render(
      <Workbench
        runtime={createWorkbenchRuntime(engine)}
        engineLabel="OpenSCAD unavailable"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        forceNarrowLayout
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const workbench = within(view.container);

    expect(workbench.getByRole("group", { name: "Workspace view" })).toBeVisible();
    expect(workbench.queryByRole("button", { name: "Collapse editor" })).not.toBeInTheDocument();
    expect(workbench.queryByRole("button", { name: "Maximize editor" })).not.toBeInTheDocument();
    expect(workbench.queryByRole("button", { name: "Collapse viewer" })).not.toBeInTheDocument();
    expect(workbench.queryByRole("button", { name: "Maximize viewer" })).not.toBeInTheDocument();
  });

  it("can omit the web menu when a native shell owns the menu bar", () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        showWebMenu={false}
        onThemePreferenceChange={vi.fn()}
      />,
    );

    expect(
      within(view.container).queryByRole("navigation", { name: "Application menu" }),
    ).not.toBeInTheDocument();
  });

  it("renders preview geometry and its measured engine bounds", async () => {
    const result: RenderSuccess3D = {
      kind: "3d",
      mesh: { format: "stl-binary", bytes: oneTriangleStl() },
      stats: {
        triangles: 12,
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        engineTimeMs: 12,
      },
      diagnostics: [],
      rawLog: "rendered",
    };
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({ jobId: "render-1", done: Promise.resolve(result) }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "command-1" });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );

    const workbench = within(view.container);
    fireEvent.click(
      within(view.container.querySelector(".titlebar") as HTMLElement).getByRole("button", {
        name: "Render preview",
      }),
    );

    expect(await workbench.findByText("10 × 10 × 10 mm")).toBeVisible();
    expect(workbench.getByText("Preview quality")).toBeVisible();
    expect(engine.render).toHaveBeenCalledTimes(1);
  });
});
