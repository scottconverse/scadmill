// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_WORKSPACE_LAYOUT } from "../../../src/application/layout/workspace-layout";
import {
  PLATFORM_MENU_COMMANDS,
  type PlatformCommandSource,
  type PlatformMenuCommand,
  type PlatformMenuState,
} from "../../../src/application/platform/scadmill-platform";
import { usePlatformMenuCommands } from "../../../src/ui/layout/use-platform-menu-commands";

function commandSource() {
  const listeners = new Set<(command: PlatformMenuCommand) => void>();
  const source: PlatformCommandSource = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    synchronize: vi.fn().mockResolvedValue(undefined),
  };
  return {
    emit: (command: PlatformMenuCommand) => {
      listeners.forEach((listener) => {
        void listener(command);
      });
    },
    listeners,
    source,
  };
}

function handlers() {
  return {
    closeDocument: vi.fn(), editorCommand: vi.fn(), exportModel: vi.fn(), layoutAction: vi.fn(),
    newFile: vi.fn(), openProject: vi.fn(), renderFull: vi.fn(), renderPreview: vi.fn(),
    reopenDocument: vi.fn(), save: vi.fn(), saveAll: vi.fn(), showHelp: vi.fn(),
  };
}

describe("usePlatformMenuCommands", () => {
  it("routes every allow-listed command and retains one live subscription across rerenders", () => {
    const commands = commandSource();
    const callbacks = handlers();
    const state: PlatformMenuState = Object.fromEntries(
      PLATFORM_MENU_COMMANDS.map((command) => [command, { enabled: true }]),
    );
    const hook = renderHook(
      ({ layout }) => usePlatformMenuCommands(commands.source, layout, false, callbacks, state),
      { initialProps: { layout: DEFAULT_WORKSPACE_LAYOUT } },
    );
    expect(commands.listeners.size).toBe(1);

    for (const command of PLATFORM_MENU_COMMANDS) act(() => commands.emit(command));

    expect(callbacks.newFile).toHaveBeenCalledOnce();
    expect(callbacks.openProject).toHaveBeenCalledOnce();
    expect(callbacks.save).toHaveBeenCalledOnce();
    expect(callbacks.saveAll).toHaveBeenCalledOnce();
    expect(callbacks.exportModel).toHaveBeenCalledOnce();
    expect(callbacks.closeDocument).toHaveBeenCalledOnce();
    expect(callbacks.reopenDocument).toHaveBeenCalledOnce();
    expect(callbacks.editorCommand.mock.calls.map(([command]) => command)).toEqual([
      "find", "replace", "go-to-line", "toggle-comment", "format-document",
      "format-selection", "undo", "redo",
    ]);
    expect(callbacks.layoutAction).toHaveBeenCalledTimes(8);
    expect(callbacks.renderPreview).toHaveBeenCalledOnce();
    expect(callbacks.renderFull).toHaveBeenCalledOnce();
    expect(callbacks.showHelp).toHaveBeenCalledOnce();

    hook.rerender({ layout: { ...DEFAULT_WORKSPACE_LAYOUT, consoleOpen: true } });
    expect(commands.listeners.size).toBe(1);
  });

  it("does not dispatch commands whose synchronized state is disabled", () => {
    const commands = commandSource();
    const callbacks = handlers();
    renderHook(() => usePlatformMenuCommands(commands.source, DEFAULT_WORKSPACE_LAYOUT, false,
      callbacks, { "render.preview": { enabled: false } }));

    act(() => commands.emit("render.preview"));

    expect(callbacks.renderPreview).not.toHaveBeenCalled();
  });
});
