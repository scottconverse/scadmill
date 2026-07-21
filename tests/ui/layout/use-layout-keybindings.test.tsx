// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceLayoutAction } from "../../../src/application/layout/workspace-layout";
import { createKeybindingSettings } from "../../../src/application/commands/default-keybindings";
import {
  mapLayoutKeybinding,
  useLayoutKeybindings,
  type LayoutKeyEvent,
  type LayoutKeybindingContext,
} from "../../../src/ui/layout/use-layout-keybindings";

const CONTROL_CONTEXT: LayoutKeybindingContext = {
  activeRail: "files",
  narrow: false,
  narrowDockOpen: false,
  narrowSheet: null,
  narrowView: "code",
  modifier: "control",
};

function keyEvent(overrides: Partial<LayoutKeyEvent>): LayoutKeyEvent {
  return {
    key: "",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...overrides,
  };
}

describe("mapLayoutKeybinding", () => {
  it.each<{
    name: string;
    event: Partial<LayoutKeyEvent>;
    expected: WorkspaceLayoutAction;
  }>([
    {
      name: "Mod+Shift+F opens project search",
      event: { key: "F", shiftKey: true },
      expected: { kind: "activate-rail", panel: "search", narrow: false },
    },
    {
      name: "Mod+J toggles the console",
      event: { key: "j" },
      expected: { kind: "toggle-panel", panel: "console" },
    },
    {
      name: "Mod+B toggles the dock",
      event: { key: "b" },
      expected: { kind: "toggle-panel", panel: "dock" },
    },
    {
      name: "Mod+Shift+B toggles parameters",
      event: { key: "B", shiftKey: true },
      expected: { kind: "toggle-panel", panel: "parameter" },
    },
    {
      name: "Mod+Shift+E toggles editor maximization",
      event: { key: "E", shiftKey: true },
      expected: { kind: "toggle-maximize", region: "editor" },
    },
    {
      name: "Mod+Shift+V toggles viewer maximization",
      event: { key: "V", shiftKey: true },
      expected: { kind: "toggle-maximize", region: "viewer" },
    },
  ])("maps $name", ({ event, expected }) => {
    expect(mapLayoutKeybinding(keyEvent(event), CONTROL_CONTEXT)).toEqual(expected);
  });

  it("switches between Code and Model with Mod+M only in narrow layout", () => {
    expect(
      mapLayoutKeybinding(keyEvent({ key: "m" }), {
        ...CONTROL_CONTEXT,
        narrow: true,
        narrowView: "code",
      }),
    ).toEqual({ kind: "set-narrow-view", view: "model" });
    expect(
      mapLayoutKeybinding(keyEvent({ key: "m" }), {
        ...CONTROL_CONTEXT,
        narrow: true,
        narrowView: "model",
      }),
    ).toEqual({ kind: "set-narrow-view", view: "code" });
    expect(mapLayoutKeybinding(keyEvent({ key: "m" }), CONTROL_CONTEXT)).toBeNull();
  });

  it("maps narrow panel shortcuts to their overlay and sheet state", () => {
    const narrowContext: LayoutKeybindingContext = {
      ...CONTROL_CONTEXT,
      narrow: true,
    };

    expect(mapLayoutKeybinding(keyEvent({ key: "b" }), narrowContext)).toEqual({
      kind: "activate-rail",
      panel: "files",
      narrow: true,
    });
    expect(mapLayoutKeybinding(keyEvent({ key: "j" }), narrowContext)).toEqual({
      kind: "set-narrow-sheet",
      sheet: "console",
    });
    expect(
      mapLayoutKeybinding(keyEvent({ key: "B", shiftKey: true }), narrowContext),
    ).toEqual({ kind: "set-narrow-sheet", sheet: "parameter" });
    expect(
      mapLayoutKeybinding(keyEvent({ key: "j" }), {
        ...narrowContext,
        narrowSheet: "console",
      }),
    ).toEqual({ kind: "set-narrow-sheet", sheet: null });
    expect(
      mapLayoutKeybinding(keyEvent({ key: "E", shiftKey: true }), narrowContext),
    ).toEqual({ kind: "set-narrow-view", view: "code" });
    expect(
      mapLayoutKeybinding(keyEvent({ key: "V", shiftKey: true }), narrowContext),
    ).toEqual({ kind: "set-narrow-view", view: "model" });
  });

  it.each([
    ["repeat", keyEvent({ key: "j", repeat: true })],
    ["Alt", keyEvent({ key: "j", altKey: true })],
    ["Shift on an unshifted shortcut", keyEvent({ key: "j", shiftKey: true })],
    ["both primary modifiers", keyEvent({ key: "j", metaKey: true })],
    ["the wrong primary modifier", keyEvent({ key: "j", ctrlKey: false, metaKey: true })],
    ["no primary modifier", keyEvent({ key: "j", ctrlKey: false })],
    ["an unrelated key", keyEvent({ key: "x" })],
  ])("ignores %s", (_name, event) => {
    expect(mapLayoutKeybinding(event, CONTROL_CONTEXT)).toBeNull();
  });

  it("uses Command rather than Control when Meta is the primary modifier", () => {
    const metaContext = { ...CONTROL_CONTEXT, modifier: "meta" as const };
    expect(
      mapLayoutKeybinding(
        keyEvent({ key: "j", ctrlKey: false, metaKey: true }),
        metaContext,
      ),
    ).toEqual({ kind: "toggle-panel", panel: "console" });
    expect(mapLayoutKeybinding(keyEvent({ key: "j" }), metaContext)).toBeNull();
  });

  it("maps an injected layout binding in the same focus scope", () => {
    const keybindings = createKeybindingSettings({ toggleConsole: "Alt+Q" });
    expect(mapLayoutKeybinding(keyEvent({
      key: "q",
      ctrlKey: false,
      altKey: true,
    }), { ...CONTROL_CONTEXT, keybindings })).toEqual({
      kind: "toggle-panel",
      panel: "console",
    });
    expect(mapLayoutKeybinding(keyEvent({ key: "j" }), {
      ...CONTROL_CONTEXT,
      keybindings,
    })).toBeNull();
  });
});

describe("useLayoutKeybindings", () => {
  it("handles shortcuts on the global target, prevents their default, and cleans up", () => {
    const dispatch = vi.fn();
    const view = renderHook(() =>
      useLayoutKeybindings({
        ...CONTROL_CONTEXT,
        dispatch,
      }),
    );

    const handled = new KeyboardEvent("keydown", {
      key: "j",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ kind: "toggle-panel", panel: "console" });

    const ignored = new KeyboardEvent("keydown", {
      key: "x",
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(ignored);
    expect(ignored.defaultPrevented).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);

    view.unmount();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "b", ctrlKey: true, cancelable: true }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
