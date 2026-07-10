// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import type { EngineService, RenderFailure } from "../../src/application/engine/contracts";
import type { WorkspaceLayoutPersistence } from "../../src/application/runtime/layout-persistence";
import { messages } from "../../src/messages/en";

class FakeDarkModeQuery {
  matches: boolean;
  readonly listeners = new Set<(event: { matches: boolean }) => void>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(_type: "change", listener: (event: { matches: boolean }) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "change", listener: (event: { matches: boolean }) => void) {
    this.listeners.delete(listener);
  }

  setMatches(matches: boolean) {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches });
  }
}

describe("App", () => {
  it("probes and starts the native engine exactly once under StrictMode", async () => {
    const result: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [],
      rawLog: "test result",
    };
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({ jobId: "render-1", done: Promise.resolve(result) }),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue({ version: "2021.01", path: "native", features: [] }),
      cancel: vi.fn(),
    };

    render(
      <StrictMode>
        <App engine={engine} />
      </StrictMode>,
    );

    expect(screen.getByText("Checking OpenSCAD…")).toBeVisible();
    await waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    expect(engine.version).toHaveBeenCalledTimes(1);
  });

  it("falls back to editor-only mode when the engine version probe rejects", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockRejectedValue(new Error("OpenSCAD executable not found")),
      cancel: vi.fn(),
    };

    const view = render(
      <StrictMode>
        <App engine={engine} />
      </StrictMode>,
    );
    const app = within(view.container);

    await waitFor(() => expect(app.queryByText("Checking OpenSCAD…")).not.toBeInTheDocument());
    expect(app.getAllByText(messages.engineUnavailable)).toHaveLength(2);
    expect(
      within(view.container.querySelector(".titlebar") as HTMLElement).getByRole("button", {
        name: messages.renderPreview,
      }),
    ).toBeDisabled();
    expect(engine.version).toHaveBeenCalledTimes(1);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("follows OS theme changes until a manual override is selected, without remounting", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockRejectedValue(new Error("OpenSCAD executable not found")),
      cancel: vi.fn(),
    };
    const darkMode = new FakeDarkModeQuery(false);
    const themeRoot = document.createElement("div");
    const props = { engine, themeHost: { root: themeRoot, darkMode } } as unknown as Parameters<
      typeof App
    >[0];

    const view = render(<App {...props} />);
    const workbench = view.container.querySelector("main");
    const picker = within(view.container).getByRole("combobox", { name: "Theme" });
    const content = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered.");
    editor.dispatch({ selection: { anchor: 0, head: 4 } });

    await waitFor(() => expect(themeRoot.dataset.theme).toBe("light"));
    expect(picker).toHaveValue("system");

    fireEvent.change(picker, { target: { value: "high-contrast" } });
    expect(themeRoot.dataset.theme).toBe("high-contrast");
    expect(themeRoot.style.getPropertyValue("--chrome-background")).not.toBe("");
    expect(view.container.querySelector("main")).toBe(workbench);
    expect(view.container.querySelector(".cm-content")).toBe(content);
    expect(EditorView.findFromDOM(content)).toBe(editor);
    expect(editor.state.doc.toString()).toBe("cube(10);");
    expect(editor.state.selection.main).toMatchObject({ from: 0, to: 4 });

    act(() => darkMode.setMatches(true));
    expect(themeRoot.dataset.theme).toBe("high-contrast");

    fireEvent.change(picker, { target: { value: "system" } });
    expect(themeRoot.dataset.theme).toBe("dark");
    act(() => darkMode.setMatches(false));
    expect(themeRoot.dataset.theme).toBe("light");

    view.unmount();
    expect(darkMode.listeners).toHaveLength(0);
  });

  it("persists all four splitter drags through an App restart", async () => {
    const originalViewportWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockRejectedValue(new Error("OpenSCAD executable not found")),
      cancel: vi.fn(),
    };
    let stored: string | null = null;
    const persistence: WorkspaceLayoutPersistence = {
      load: () => stored,
      save: (value) => {
        stored = value;
      },
    };
    const first = render(<App engine={engine} layoutPersistence={persistence} />);
    const firstApp = within(first.container);
    const drags = [
      { name: "Resize files panel", pointerId: 1, from: [100, 20], to: [140, 20] },
      { name: "Resize viewer column", pointerId: 2, from: [600, 20], to: [560, 20] },
      { name: "Resize parameters", pointerId: 3, from: [20, 500], to: [20, 460] },
      { name: "Resize console", pointerId: 4, from: [20, 700], to: [20, 660] },
    ] as const;

    for (const drag of drags) {
      const splitter = firstApp.getByRole("separator", { name: drag.name });
      fireEvent.pointerDown(splitter, {
        pointerId: drag.pointerId,
        clientX: drag.from[0],
        clientY: drag.from[1],
      });
      fireEvent.pointerMove(splitter, {
        pointerId: drag.pointerId,
        clientX: drag.to[0],
        clientY: drag.to[1],
      });
      fireEvent.pointerUp(splitter, {
        pointerId: drag.pointerId,
        clientX: drag.to[0],
        clientY: drag.to[1],
      });
    }
    await waitFor(() => expect(stored).not.toBeNull());
    first.unmount();

    const second = render(<App engine={engine} layoutPersistence={persistence} />);
    const restored = within(second.container);
    expect(restored.getByRole("separator", { name: "Resize files panel" })).toHaveAttribute(
      "aria-valuenow",
      "300",
    );
    expect(restored.getByRole("separator", { name: "Resize viewer column" })).toHaveAttribute(
      "aria-valuenow",
      "520",
    );
    expect(restored.getByRole("separator", { name: "Resize parameters" })).toHaveAttribute(
      "aria-valuenow",
      "260",
    );
    expect(restored.getByRole("separator", { name: "Resize console" })).toHaveAttribute(
      "aria-valuenow",
      "220",
    );
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: originalViewportWidth,
    });
  });
});
