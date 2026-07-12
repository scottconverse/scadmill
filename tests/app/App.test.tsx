// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import type { EngineService, RenderFailure } from "../../src/application/engine/contracts";
import { PINNED_OPENSCAD_VERSION } from "../../src/application/engine/engine-pin";
import type { WorkspaceLayoutPersistence } from "../../src/application/runtime/layout-persistence";
import {
  createDefaultPersistedSettings,
  serializePersistedSettings,
} from "../../src/application/settings/settings-codec";
import type { SettingsPersistence } from "../../src/application/settings/settings-persistence";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { customThemePreference } from "../../src/application/theme/theme-registry";
import { messages } from "../../src/messages/en";
import { createBrowserSettingsPersistence } from "../../src/platform-web/browser-settings-persistence";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("App", () => {
  it("surfaces a transient settings read failure and catches non-dialog settings dispatches", async () => {
    const setItem = vi.fn();
    const settingsPersistence = createBrowserSettingsPersistence({
      getItem: () => { throw new Error("temporary read failure"); },
      setItem,
    });
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
    };
    const view = render(<App engine={engine} settingsPersistence={settingsPersistence} />);
    const app = within(view.container);

    expect(app.getByRole("alert")).toHaveTextContent(messages.settingsLoadFailed);
    fireEvent.change(app.getByRole("combobox", { name: messages.themeLabel }), {
      target: { value: "high-contrast" },
    });
    await Promise.resolve();

    expect(setItem).not.toHaveBeenCalled();
    expect(app.getByRole("combobox", { name: messages.themeLabel })).toHaveValue("system");
  });

  it("shows only the checking state while the initial engine probe is pending", () => {
    const probe = deferred<Awaited<ReturnType<EngineService["version"]>>>();
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockReturnValue(probe.promise),
      cancel: vi.fn(),
    };

    render(<App engine={engine} />);

    expect(screen.getByText("Checking OpenSCAD…")).toBeVisible();
    expect(screen.queryByText(messages.engineUnavailable)).not.toBeInTheDocument();
  });

  it("returns focus to the settings launcher after the dialog closes", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
    };
    const view = render(<App engine={engine} />);
    const app = within(view.container);
    const launcher = app.getByRole("button", { name: messages.openSettings });
    fireEvent.click(launcher);
    fireEvent.click(await app.findByRole("button", { name: messages.closeSettings }));

    await waitFor(() =>
      expect(app.queryByRole("dialog", { name: messages.settingsTitle })).not.toBeInTheDocument()
    );
    expect(launcher).toHaveFocus();
  });

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
      version: vi.fn().mockResolvedValue({
        version: PINNED_OPENSCAD_VERSION,
        path: "native",
        features: [],
      }),
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

  it("formats the ready engine status through the message catalog", async () => {
    const engineReady = vi.spyOn(messages, "engineReady");
    const result: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [],
      rawLog: "test result",
    };
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({ jobId: "render-1", done: Promise.resolve(result) }),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue({
        version: PINNED_OPENSCAD_VERSION,
        path: "native",
        features: [],
      }),
      cancel: vi.fn(),
    };

    render(<App engine={engine} />);

    await waitFor(() => expect(engineReady).toHaveBeenCalledWith(PINNED_OPENSCAD_VERSION));
    expect(screen.getByText(messages.engineReady(PINNED_OPENSCAD_VERSION))).toBeVisible();
    engineReady.mockRestore();
  });

  it("refuses to enable rendering for an engine older than the recorded pin", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue({ version: "2021.01", path: "native", features: [] }),
      cancel: vi.fn(),
    };
    const configuration = { load: vi.fn(() => ""), save: vi.fn() };
    const view = render(<App engine={engine} enginePathConfiguration={configuration} />);
    const app = within(view.container);

    await waitFor(() => expect(app.queryByText(messages.checkingEngine)).not.toBeInTheDocument());
    expect(engine.render).not.toHaveBeenCalled();
    expect(app.getAllByText(messages.engineVersionUnsupported(
      "2021.01",
      PINNED_OPENSCAD_VERSION,
    ))).toHaveLength(2);
    expect(app.getByRole("textbox", { name: messages.engineExecutablePath })).toBeVisible();
  });

  it("uses the persisted default quality for the initial automatic render", async () => {
    const result: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [],
      rawLog: "test result",
    };
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({ jobId: "initial-full", done: Promise.resolve(result) }),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue({
        version: PINNED_OPENSCAD_VERSION,
        path: "native",
        features: [],
      }),
      cancel: vi.fn(),
    };
    const defaults = createDefaultPersistedSettings();
    const settingsPersistence: SettingsPersistence = {
      load: () => ({
        kind: "loaded",
        serializedSettings: serializePersistedSettings({
          ...defaults,
          rendering: { ...defaults.rendering, defaultQuality: "full" },
        }),
      }),
      save: vi.fn(),
    };

    render(<App engine={engine} settingsPersistence={settingsPersistence} />);

    await waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
    expect(engine.render).toHaveBeenCalledWith(expect.objectContaining({
      quality: "full",
      timeoutMs: 600_000,
    }));
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

    await waitFor(() => expect(app.queryByText(messages.checkingEngine)).not.toBeInTheDocument());
    expect(app.getAllByText(messages.engineUnavailable)).toHaveLength(2);
    expect(
      within(view.container.querySelector(".titlebar") as HTMLElement).getByRole("button", {
        name: messages.renderPreview,
      }),
    ).toBeDisabled();
    expect(engine.version).toHaveBeenCalledTimes(1);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("keeps CodeMirror editable and rendering disabled when the engine probe returns null", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
    };
    const view = render(<App engine={engine} />);
    const app = within(view.container);

    await waitFor(() => expect(app.queryByText(messages.checkingEngine)).not.toBeInTheDocument());
    expect(app.getAllByText(messages.engineUnavailable)).toHaveLength(2);
    expect(app.getAllByText(
      "OpenSCAD is unavailable. Editing and local project features remain available; rendering and model export are disabled.",
    )).toHaveLength(2);
    expect(app.getByRole("button", { name: messages.renderPreview })).toBeDisabled();
    expect(app.getByRole("button", { name: messages.renderFull })).toBeDisabled();

    const content = await waitFor(() => {
      const node = view.container.querySelector<HTMLElement>(".cm-content");
      if (!node) throw new Error("CodeMirror did not mount.");
      return node;
    });
    const editor = EditorView.findFromDOM(content);
    if (!editor) throw new Error("CodeMirror view could not be recovered.");
    act(() => {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: "sphere(8);" },
      });
    });

    expect(editor.state.doc.toString()).toBe("sphere(8);");
    expect(
      await app.findByRole("tab", { name: messages.documentTabUnsaved("Untitled") }),
    ).toBeVisible();
    await act(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 900));
    });
    expect(engine.version).toHaveBeenCalledTimes(1);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it("saves a configured engine path from the missing-engine fix-it and retries discovery", async () => {
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "configured-render",
        done: Promise.resolve<RenderFailure>({
          kind: "failure",
          reason: "engine-error",
          diagnostics: [],
          rawLog: "test",
        }),
      }),
      export: vi.fn(),
      version: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          version: PINNED_OPENSCAD_VERSION,
          path: "native",
          features: [],
        }),
      cancel: vi.fn(),
    };
    let configuredPath = "";
    const configuration = {
      load: vi.fn(() => configuredPath),
      save: vi.fn((path: string) => { configuredPath = path; }),
    };
    const view = render(<App engine={engine} enginePathConfiguration={configuration} />);
    const app = within(view.container);
    const fix = await app.findByRole("button", { name: messages.fixEngine });

    fireEvent.click(fix);
    fireEvent.change(app.getByRole("textbox", { name: messages.engineExecutablePath }), {
      target: { value: "C:\\OpenSCAD\\openscad.exe" },
    });
    fireEvent.click(app.getByRole("button", { name: messages.saveEnginePath }));

    await waitFor(() => expect(engine.version).toHaveBeenCalledTimes(2));
    expect(configuration.save).toHaveBeenCalledWith("C:\\OpenSCAD\\openscad.exe");
    await waitFor(() => expect(engine.render).toHaveBeenCalledTimes(1));
  });

  it("applies an engine path changed in settings to native discovery immediately", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
    };
    let configuredPath = "";
    const configuration = {
      load: vi.fn(() => configuredPath),
      save: vi.fn((path: string) => { configuredPath = path; }),
    };
    const view = render(<App engine={engine} enginePathConfiguration={configuration} />);
    const app = within(view.container);
    await app.findByRole("button", { name: messages.fixEngine });
    fireEvent.click(app.getByRole("button", { name: messages.openSettings }));

    fireEvent.change(app.getByLabelText(messages.enginePath), {
      target: { value: "C:\\OpenSCAD\\openscad.exe" },
    });

    await waitFor(() => expect(configuration.save).toHaveBeenCalledWith(
      "C:\\OpenSCAD\\openscad.exe",
    ));
    await waitFor(() => expect(engine.version).toHaveBeenCalledTimes(2));
  });

  it("distinguishes a rejected configured path and keeps it available for correction", async () => {
    const configuredPath = "C:\\Missing\\openscad.exe";
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
    };
    const configuration = {
      load: vi.fn(() => configuredPath),
      save: vi.fn(),
    };

    const view = render(<App engine={engine} enginePathConfiguration={configuration} />);
    const app = within(view.container);

    expect(await app.findByText(
      "That OpenSCAD executable could not be used. Check the path and try again.",
    )).toBeVisible();
    expect(app.getByText(`Rejected path: ${configuredPath}`)).toBeVisible();
    expect(app.getByRole("textbox", { name: messages.engineExecutablePath })).toHaveValue(
      configuredPath,
    );
    expect(app.queryByText(messages.engineUnavailable)).not.toBeInTheDocument();
  });

  it("preserves a corrected engine-path draft across an unrelated App rerender", async () => {
    const configuredPath = "C:\\Missing\\openscad.exe";
    const correctedPath = "C:\\OpenSCAD\\openscad.exe";
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
    };
    const configuration = {
      load: vi.fn(() => configuredPath),
      save: vi.fn(),
    };
    const props = { engine, enginePathConfiguration: configuration };
    const view = render(<App {...props} />);
    const app = within(view.container);
    const input = await app.findByRole("textbox", { name: messages.engineExecutablePath });

    fireEvent.change(input, { target: { value: correctedPath } });
    expect(input).toHaveValue(correctedPath);

    view.rerender(<App {...props} />);

    expect(input).toHaveValue(correctedPath);
  });

  it("shows retry progress and deduplicates configured-path submission", async () => {
    const retry = deferred<Awaited<ReturnType<EngineService["version"]>>>();
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValueOnce(null).mockReturnValueOnce(retry.promise),
      cancel: vi.fn(),
    };
    let configuredPath = "";
    const configuration = {
      load: vi.fn(() => configuredPath),
      save: vi.fn((path: string) => { configuredPath = path; }),
    };
    const view = render(<App engine={engine} enginePathConfiguration={configuration} />);
    const app = within(view.container);
    fireEvent.click(await app.findByRole("button", { name: messages.fixEngine }));
    fireEvent.change(app.getByRole("textbox", { name: messages.engineExecutablePath }), {
      target: { value: "C:\\OpenSCAD\\openscad.exe" },
    });

    fireEvent.click(app.getByRole("button", { name: messages.saveEnginePath }));

    expect(await app.findByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(app.queryByText(messages.engineUnavailable)).not.toBeInTheDocument();
    expect(configuration.save).toHaveBeenCalledTimes(1);
    expect(engine.version).toHaveBeenCalledTimes(2);
    retry.resolve(null);
    await waitFor(() => {
      expect(app.queryByRole("button", { name: "Checking…" })).not.toBeInTheDocument();
    });
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
    editor.dispatch({ selection: { anchor: 0, head: 0 } });

    await waitFor(() => expect(themeRoot.dataset.theme).toBe("light"));
    expect(picker).toHaveValue("system");

    fireEvent.change(picker, { target: { value: "high-contrast" } });
    expect(themeRoot.dataset.theme).toBe("high-contrast");
    expect(themeRoot.style.getPropertyValue("--chrome-background")).not.toBe("");
    expect(view.container.querySelector("main")).toBe(workbench);
    expect(view.container.querySelector(".cm-content")).toBe(content);
    expect(EditorView.findFromDOM(content)).toBe(editor);
    expect(editor.state.doc.toString()).toBe("");
    expect(editor.state.selection.main).toMatchObject({ from: 0, to: 0 });

    act(() => darkMode.setMatches(true));
    expect(themeRoot.dataset.theme).toBe("high-contrast");

    fireEvent.change(picker, { target: { value: "system" } });
    expect(themeRoot.dataset.theme).toBe("dark");
    act(() => darkMode.setMatches(false));
    expect(themeRoot.dataset.theme).toBe("light");

    view.unmount();
    expect(darkMode.listeners).toHaveLength(0);
  });

  it("restores and applies a persisted custom theme without a reload", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn().mockResolvedValue(null),
      cancel: vi.fn(),
    };
    const theme = {
      ...SHIPPED_THEMES[0],
      meta: { name: "Workshop blue", kind: "dark" as const, version: 1 as const },
      chrome: { ...SHIPPED_THEMES[0].chrome, background: "#101216" },
    };
    const defaults = createDefaultPersistedSettings();
    const profile = {
      ...defaults,
      theme: {
        preference: customThemePreference(theme.meta.name),
        customThemes: [theme],
      },
    };
    const settingsPersistence: SettingsPersistence = {
      load: () => ({
        kind: "loaded",
        serializedSettings: serializePersistedSettings(profile),
      }),
      save: vi.fn(),
    };
    const themeRoot = document.createElement("div");
    const darkMode = new FakeDarkModeQuery(false);

    const view = render(
      <App
        engine={engine}
        settingsPersistence={settingsPersistence}
        themeHost={{ root: themeRoot, darkMode }}
      />,
    );

    await waitFor(() =>
      expect(themeRoot.style.getPropertyValue("--chrome-background")).toBe("#101216")
    );
    expect(within(view.container).getByRole("combobox", { name: messages.themeLabel })).toHaveValue(
      customThemePreference(theme.meta.name),
    );
    expect(within(view.container).getByRole("option", { name: theme.meta.name })).toBeVisible();
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
      load: (_workspaceIdentity) => stored,
      save: (_workspaceIdentity, value) => {
        stored = value;
      },
    };
    const first = render(<App engine={engine} layoutPersistence={persistence} />);
    const firstApp = within(first.container);
    fireEvent.click(firstApp.getByRole("button", { name: "Toggle console" }));
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
