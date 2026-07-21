// @vitest-environment happy-dom
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../src/application/engine/contracts";
import type {
  PlatformCommandSource,
  PlatformMenuCommand,
} from "../../src/application/platform/scadmill-platform";
import { createWorkbenchRuntime } from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { messages } from "../../src/messages/en";
import { Workbench } from "../../src/ui/Workbench";

function controllableCommandSource() {
  const listeners = new Set<(command: PlatformMenuCommand) => void>();
  const states: Array<Readonly<Partial<Record<PlatformMenuCommand, { readonly enabled: boolean }>>>> = [];
  const source: PlatformCommandSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async synchronize(state) { states.push(state); },
  };
  return {
    source,
    emit(command: PlatformMenuCommand) {
      for (const listener of listeners) listener(command);
    },
    states,
  };
}

describe("Workbench native menu command routing", () => {
  it("routes native File, Edit, View, Render, and Help events through production handlers", async () => {
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "native-menu-render",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve({
          kind: "3d",
          mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
          stats: { triangles: 0, engineTimeMs: 1 },
          diagnostics: [],
          rawLog: "",
        }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, {
      initialScratchPath: "main.scad",
      initialScratchSource: "cube(10);",
      makeId: () => "native-menu-command",
    });
    await runtime.dispatch({ kind: "set-auto-render", origin: "user", enabled: false });
    const commands = controllableCommandSource();
    const view = render(
      <Workbench
        runtime={runtime}
        engine={engine}
        engineLabel="OpenSCAD 2026.06.12"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        showWebMenu={false}
        menuCommandSource={commands.source}
        onThemePreferenceChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(view.container.querySelector(".cm-content")).not.toBeNull());
    expect(within(view.container).queryByRole("navigation", { name: messages.applicationMenu }))
      .not.toBeInTheDocument();

    act(() => commands.emit("view.toggle-console"));
    await waitFor(() => expect(runtime.layout.getState().consoleOpen).toBe(true));

    act(() => commands.emit("edit.find"));
    await waitFor(() => expect(view.container.querySelector(".cm-search")) .not.toBeNull());

    const beforeNew = runtime.documents.getState().documents.length;
    act(() => commands.emit("file.new"));
    await waitFor(() => expect(runtime.documents.getState().documents).toHaveLength(beforeNew + 1));

    act(() => commands.emit("render.preview"));
    await waitFor(() => expect(engine.render).toHaveBeenCalled());

    const settingsButton = within(view.container).getByRole("button", { name: messages.openSettings });
    settingsButton.focus();
    act(() => commands.emit("help.show"));
    const help = within(view.container).getByRole("dialog", { name: messages.helpInformation });
    expect(help).toHaveTextContent(messages.helpSummary);
    expect(within(help).getByRole("button", { name: messages.viewKeyboardShortcuts })).toBeVisible();
    expect(within(help).getByRole("button", { name: messages.closeHelp })).toBeVisible();
    expect(within(help).getByRole("button", { name: messages.viewKeyboardShortcuts })).toHaveFocus();
    fireEvent.keyDown(help, { key: "Escape" });
    expect(within(view.container).queryByRole("dialog", { name: messages.helpInformation }))
      .not.toBeInTheDocument();
    expect(settingsButton).toHaveFocus();
    expect(commands.states.at(-1)?.["render.preview"]?.enabled).toBe(true);
  });

  it("guards unavailable native commands and keeps one subscription during rerenders", async () => {
    const engine: EngineService = {
      render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    const commands = controllableCommandSource();
    const view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        engine={engine}
        engineAvailable={false}
        engineLabel="Unavailable"
        menuCommandSource={commands.source}
        onThemePreferenceChange={vi.fn()}
        runtime={runtime}
        showWebMenu={false}
        themePreference="system"
      />,
    );

    await waitFor(() => expect(commands.states.length).toBeGreaterThan(0));
    act(() => commands.emit("render.preview"));
    expect(engine.render).not.toHaveBeenCalled();

    view.rerender(
      <Workbench
        activeTheme={SHIPPED_THEMES[1]}
        engine={engine}
        engineAvailable={false}
        engineLabel="Unavailable"
        menuCommandSource={commands.source}
        onThemePreferenceChange={vi.fn()}
        runtime={runtime}
        showWebMenu={false}
        themePreference="dark"
      />,
    );
    act(() => commands.emit("view.toggle-console"));
    await waitFor(() => expect(runtime.layout.getState().consoleOpen).toBe(true));

    await act(() => runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: runtime.documents.getState().activeDocumentId,
      source: "cube(11);",
    }));
    await waitFor(() => expect(commands.states.length).toBeGreaterThan(1));
    const synchronizedAfterDirtyTransition = commands.states.length;
    await act(() => runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: runtime.documents.getState().activeDocumentId,
      source: "cube(12);",
    }));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    expect(commands.states).toHaveLength(synchronizedAfterDirtyTransition);
  });
});
