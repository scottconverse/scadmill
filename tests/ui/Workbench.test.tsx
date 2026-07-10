// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess3D } from "../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
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
    expect(workbench.getByRole("region", { name: "Console" })).toBeVisible();
    expect(workbench.getAllByRole("separator")).toHaveLength(4);

    fireEvent.click(workbench.getByRole("button", { name: "Search" }));

    expect(await workbench.findByRole("region", { name: "Search panel" })).toBeVisible();
    expect(runtime.layout.getState()).toMatchObject({ activeRail: "search", dockOpen: true });
    expect(runtime.history.getState().at(-1)).toMatchObject({
      kind: "update-layout",
      summary: "Activate search rail",
    });
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
    ).getByRole("button", { name: "Toggle console: No diagnostics yet" });
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
    await waitFor(() => expect(runtime.layout.getState().consoleOpen).toBe(false));
  });

  it("keeps honest diagnostics, cursor, and theme controls in the status bar", async () => {
    const engine: EngineService = {
      render: vi.fn(),
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
    expect(workbench.getByRole("combobox", { name: "Theme" }).closest("footer")).toHaveClass(
      "statusbar",
    );
    expect(workbench.getByText("No diagnostics yet")).toBeVisible();
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
          rawLog: "Parser error\nDeprecated form",
        }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "toggle-panel", panel: "console" },
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
    const titlebar = within(view.container.querySelector(".titlebar") as HTMLElement);

    fireEvent.click(titlebar.getByRole("button", { name: "Render preview" }));

    const status = within(view.container.querySelector("footer") as HTMLElement);
    expect(
      await status.findByRole("button", {
        name: "Toggle console: 1 error, 1 warning",
      }),
    ).toBeVisible();
    const consoleRegion = within(view.container).getByRole("region", { name: "Console" });
    expect(consoleRegion).toBeVisible();
    expect(within(consoleRegion).getByText("Parser error")).toBeVisible();
    expect(within(consoleRegion).getByText("Deprecated form")).toBeVisible();
    expect(within(consoleRegion).queryByText("No diagnostics from this session.")).not.toBeInTheDocument();
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
