import type {
  ActivityPanel,
  NarrowSheet,
  NarrowView,
  WorkspaceLayoutAction,
} from "../../application/layout/workspace-layout";
import {
  DEFAULT_KEYBINDINGS,
  type KeybindingSettings,
  type PrimaryModifier,
  matchesKeybinding,
  primaryModifierForPlatform,
} from "../../application/commands/default-keybindings";
import { useEffect } from "react";

export type LayoutPrimaryModifier = PrimaryModifier;

export interface LayoutKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly repeat: boolean;
}

export interface LayoutKeybindingContext {
  readonly activeRail: ActivityPanel;
  readonly narrow: boolean;
  readonly narrowDockOpen: boolean;
  readonly narrowSheet: NarrowSheet;
  readonly narrowView: NarrowView;
  readonly modifier: LayoutPrimaryModifier;
  readonly keybindings?: KeybindingSettings;
}

export interface LayoutKeybindingOptions {
  readonly activeRail: ActivityPanel;
  readonly narrow: boolean;
  readonly narrowDockOpen: boolean;
  readonly narrowSheet: NarrowSheet;
  readonly narrowView: NarrowView;
  readonly modifier?: LayoutPrimaryModifier;
  readonly keybindings?: KeybindingSettings;
  readonly dispatch: (action: WorkspaceLayoutAction) => void;
}

export function mapLayoutKeybinding(
  event: LayoutKeyEvent,
  context: LayoutKeybindingContext,
): WorkspaceLayoutAction | null {
  if (event.repeat) return null;
  const keybindings = context.keybindings ?? DEFAULT_KEYBINDINGS;
  const matches = (binding: string) => matchesKeybinding(event, binding, context.modifier);
  if (matches(keybindings.toggleConsole)) {
    return context.narrow
      ? {
          kind: "set-narrow-sheet",
          sheet: context.narrowSheet === "console" ? null : "console",
        }
      : { kind: "toggle-panel", panel: "console" };
  }
  if (matches(keybindings.toggleParameters)) {
    return context.narrow
      ? {
          kind: "set-narrow-sheet",
          sheet: context.narrowSheet === "parameter" ? null : "parameter",
        }
      : { kind: "toggle-panel", panel: "parameter" };
  }
  if (matches(keybindings.toggleDock)) {
    return context.narrow
      ? { kind: "activate-rail", panel: context.activeRail, narrow: true }
      : { kind: "toggle-panel", panel: "dock" };
  }
  if (matches(keybindings.maximizeEditor)) {
    return context.narrow
      ? { kind: "set-narrow-view", view: "code" }
      : { kind: "toggle-maximize", region: "editor" };
  }
  if (matches(keybindings.maximizeViewer)) {
    return context.narrow
      ? { kind: "set-narrow-view", view: "model" }
      : { kind: "toggle-maximize", region: "viewer" };
  }
  if (context.narrow && matches(keybindings.switchCodeModel)) {
    return {
      kind: "set-narrow-view",
      view: context.narrowView === "code" ? "model" : "code",
    };
  }
  return null;
}

export function useLayoutKeybindings(options: LayoutKeybindingOptions): void {
  const {
    activeRail,
    dispatch,
    narrow,
    narrowDockOpen,
    narrowSheet,
    narrowView,
  } = options;
  const modifier = options.modifier ?? primaryModifierForPlatform();
  const keybindings = options.keybindings ?? DEFAULT_KEYBINDINGS;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = mapLayoutKeybinding(event, {
        activeRail,
        narrow,
        narrowDockOpen,
        narrowSheet,
        narrowView,
        modifier,
        keybindings,
      });
      if (action === null) return;
      event.preventDefault();
      dispatch(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRail, dispatch, keybindings, modifier, narrow, narrowDockOpen, narrowSheet, narrowView]);
}
