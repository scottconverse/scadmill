import type {
  ActivityPanel,
  NarrowSheet,
  NarrowView,
  WorkspaceLayoutAction,
} from "../../application/layout/workspace-layout";
import { useEffect } from "react";

export type LayoutPrimaryModifier = "control" | "meta";

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
}

export interface LayoutKeybindingOptions {
  readonly activeRail: ActivityPanel;
  readonly narrow: boolean;
  readonly narrowDockOpen: boolean;
  readonly narrowSheet: NarrowSheet;
  readonly narrowView: NarrowView;
  readonly modifier?: LayoutPrimaryModifier;
  readonly dispatch: (action: WorkspaceLayoutAction) => void;
}

function defaultPrimaryModifier(): LayoutPrimaryModifier {
  return /Mac|iPhone|iPad|iPod/i.test(globalThis.navigator?.platform ?? "")
    ? "meta"
    : "control";
}

export function mapLayoutKeybinding(
  event: LayoutKeyEvent,
  context: LayoutKeybindingContext,
): WorkspaceLayoutAction | null {
  if (event.repeat || event.altKey) return null;

  const primaryPressed =
    context.modifier === "meta"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  if (!primaryPressed) return null;

  switch (event.key.toLowerCase()) {
    case "j":
      if (event.shiftKey) return null;
      return context.narrow
        ? {
            kind: "set-narrow-sheet",
            sheet: context.narrowSheet === "console" ? null : "console",
          }
        : { kind: "toggle-panel", panel: "console" };
    case "b":
      if (context.narrow) {
        return event.shiftKey
          ? {
              kind: "set-narrow-sheet",
              sheet: context.narrowSheet === "parameter" ? null : "parameter",
            }
          : { kind: "activate-rail", panel: context.activeRail, narrow: true };
      }
      return { kind: "toggle-panel", panel: event.shiftKey ? "parameter" : "dock" };
    case "e":
      return event.shiftKey
        ? context.narrow
          ? { kind: "set-narrow-view", view: "code" }
          : { kind: "toggle-maximize", region: "editor" }
        : null;
    case "v":
      return event.shiftKey
        ? context.narrow
          ? { kind: "set-narrow-view", view: "model" }
          : { kind: "toggle-maximize", region: "viewer" }
        : null;
    case "m":
      return !event.shiftKey && context.narrow
        ? {
            kind: "set-narrow-view",
            view: context.narrowView === "code" ? "model" : "code",
          }
        : null;
    default:
      return null;
  }
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
  const modifier = options.modifier ?? defaultPrimaryModifier();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (event: KeyboardEvent) => {
      const action = mapLayoutKeybinding(event, {
        activeRail,
        narrow,
        narrowDockOpen,
        narrowSheet,
        narrowView,
        modifier,
      });
      if (action === null) return;
      event.preventDefault();
      dispatch(action);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeRail, dispatch, modifier, narrow, narrowDockOpen, narrowSheet, narrowView]);
}
