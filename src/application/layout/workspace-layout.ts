export const ACTIVITY_PANELS = ["files", "search", "history", "ai", "libraries"] as const;

export type ActivityPanel = (typeof ACTIVITY_PANELS)[number];
export type CollapsiblePanel = "dock" | "editor" | "viewer" | "parameter" | "console";
export type ResizablePanel = "dock" | "viewer" | "parameter" | "console";
export type MaximizedRegion = "editor" | "viewer" | null;
export type NarrowView = "code" | "model";
export type NarrowSheet = "parameter" | "console" | null;

export interface WorkspaceLayoutState {
  readonly activeRail: ActivityPanel;
  readonly dockOpen: boolean;
  readonly editorOpen: boolean;
  readonly viewerOpen: boolean;
  readonly parameterOpen: boolean;
  readonly consoleOpen: boolean;
  readonly dockWidth: number;
  readonly viewerWidth: number;
  readonly parameterHeight: number;
  readonly consoleHeight: number;
  readonly maximized: MaximizedRegion;
  readonly narrowView: NarrowView;
  readonly narrowDockOpen: boolean;
  readonly narrowSheet: NarrowSheet;
  readonly consoleAutoOpenedForJobId?: string;
}

export type WorkspaceLayoutAction =
  | { readonly kind: "activate-rail"; readonly panel: ActivityPanel; readonly narrow: boolean }
  | { readonly kind: "resize-panel"; readonly panel: ResizablePanel; readonly size: number }
  | { readonly kind: "toggle-panel"; readonly panel: CollapsiblePanel }
  | { readonly kind: "toggle-maximize"; readonly region: Exclude<MaximizedRegion, null> }
  | { readonly kind: "set-narrow-view"; readonly view: NarrowView }
  | { readonly kind: "set-narrow-sheet"; readonly sheet: NarrowSheet }
  | { readonly kind: "close-narrow-dock" }
  | { readonly kind: "render-failed"; readonly jobId: string }
  | { readonly kind: "render-succeeded"; readonly jobId: string }
  | { readonly kind: "reset-layout" };

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutState = Object.freeze({
  activeRail: "files",
  dockOpen: true,
  editorOpen: true,
  viewerOpen: true,
  parameterOpen: true,
  consoleOpen: false,
  dockWidth: 260,
  viewerWidth: 480,
  parameterHeight: 220,
  consoleHeight: 180,
  maximized: null,
  narrowView: "code",
  narrowDockOpen: false,
  narrowSheet: null,
});

const SIZE_LIMITS: Readonly<Record<ResizablePanel, readonly [minimum: number, maximum: number]>> = {
  dock: [180, 480],
  viewer: [320, 720],
  parameter: [120, 480],
  console: [100, 400],
};

const PERSISTED_KEYS = [
  "version",
  "activeRail",
  "dockOpen",
  "editorOpen",
  "viewerOpen",
  "parameterOpen",
  "consoleOpen",
  "dockWidth",
  "viewerWidth",
  "parameterHeight",
  "consoleHeight",
  "narrowView",
] as const;

function resize(
  state: WorkspaceLayoutState,
  panel: ResizablePanel,
  requestedSize: number,
): WorkspaceLayoutState {
  if (!Number.isFinite(requestedSize)) return state;
  const [minimum, maximum] = SIZE_LIMITS[panel];
  const size = Math.min(Math.max(Math.round(requestedSize), minimum), maximum);
  const field = `${panel}${panel === "parameter" || panel === "console" ? "Height" : "Width"}` as
    | "dockWidth"
    | "viewerWidth"
    | "parameterHeight"
    | "consoleHeight";
  return state[field] === size ? state : { ...state, [field]: size };
}

function togglePanel(
  state: WorkspaceLayoutState,
  panel: CollapsiblePanel,
): WorkspaceLayoutState {
  const field = `${panel}Open` as
    | "dockOpen"
    | "editorOpen"
    | "viewerOpen"
    | "parameterOpen"
    | "consoleOpen";
  const maximized = state.maximized === panel ? null : state.maximized;
  const narrowSheet = state[field]
    && (panel === "parameter" || panel === "console")
    && state.narrowSheet === panel
    ? null
    : state.narrowSheet;
  return { ...state, [field]: !state[field], maximized, narrowSheet };
}

export function reduceWorkspaceLayout(
  state: WorkspaceLayoutState,
  action: WorkspaceLayoutAction,
): WorkspaceLayoutState {
  switch (action.kind) {
    case "activate-rail": {
      if (action.narrow) {
        const sameOpenPanel = state.activeRail === action.panel && state.narrowDockOpen;
        return {
          ...state,
          activeRail: action.panel,
          narrowDockOpen: !sameOpenPanel,
          narrowSheet: null,
        };
      }
      const sameOpenPanel = state.activeRail === action.panel && state.dockOpen;
      return {
        ...state,
        activeRail: action.panel,
        dockOpen: !sameOpenPanel,
      };
    }
    case "resize-panel":
      return resize(state, action.panel, action.size);
    case "toggle-panel":
      return togglePanel(state, action.panel);
    case "toggle-maximize": {
      if (state.maximized === action.region) return { ...state, maximized: null };
      const openField = `${action.region}Open` as "editorOpen" | "viewerOpen";
      return { ...state, [openField]: true, maximized: action.region };
    }
    case "set-narrow-view":
      return state.narrowView === action.view
        && (action.view !== "code" || state.narrowSheet !== "parameter")
        ? state
        : {
            ...state,
            narrowView: action.view,
            narrowDockOpen: false,
            narrowSheet: action.view === "code" && state.narrowSheet === "parameter"
              ? null
              : state.narrowSheet,
          };
    case "set-narrow-sheet":
      return state.narrowSheet === action.sheet
        && (action.sheet !== "parameter" || state.narrowView === "model")
        ? state
        : {
            ...state,
            narrowView: action.sheet === "parameter" ? "model" : state.narrowView,
            narrowSheet: action.sheet,
            narrowDockOpen: false,
          };
    case "close-narrow-dock":
      return state.narrowDockOpen ? { ...state, narrowDockOpen: false } : state;
    case "render-failed":
      return state.consoleAutoOpenedForJobId === action.jobId
        ? state
        : {
            ...state,
            consoleOpen: true,
            maximized: null,
            narrowDockOpen: false,
            narrowSheet: "console",
            consoleAutoOpenedForJobId: action.jobId,
          };
    case "render-succeeded":
      return state;
    case "reset-layout":
      return DEFAULT_WORKSPACE_LAYOUT;
  }
}

export function serializeWorkspaceLayout(state: WorkspaceLayoutState): string {
  return JSON.stringify({
    version: 1,
    activeRail: state.activeRail,
    dockOpen: state.dockOpen,
    editorOpen: state.editorOpen,
    viewerOpen: state.viewerOpen,
    parameterOpen: state.parameterOpen,
    consoleOpen: state.consoleOpen,
    dockWidth: state.dockWidth,
    viewerWidth: state.viewerWidth,
    parameterHeight: state.parameterHeight,
    consoleHeight: state.consoleHeight,
    narrowView: state.narrowView,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBooleanRecord(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every((key) => typeof value[key] === "boolean");
}

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === PERSISTED_KEYS.length && PERSISTED_KEYS.every((key) => Object.hasOwn(value, key));
}

function isSize(panel: ResizablePanel, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const [minimum, maximum] = SIZE_LIMITS[panel];
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function parseWorkspaceLayout(source: string | null): WorkspaceLayoutState {
  if (source === null) return DEFAULT_WORKSPACE_LAYOUT;
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT;
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value) ||
    value.version !== 1 ||
    !ACTIVITY_PANELS.some((panel) => value.activeRail === panel) ||
    !isBooleanRecord(value, [
      "dockOpen",
      "editorOpen",
      "viewerOpen",
      "parameterOpen",
      "consoleOpen",
    ]) ||
    !isSize("dock", value.dockWidth) ||
    !isSize("viewer", value.viewerWidth) ||
    !isSize("parameter", value.parameterHeight) ||
    !isSize("console", value.consoleHeight) ||
    (value.narrowView !== "code" && value.narrowView !== "model")
  ) {
    return DEFAULT_WORKSPACE_LAYOUT;
  }

  return Object.freeze({
    activeRail: value.activeRail as ActivityPanel,
    dockOpen: value.dockOpen as boolean,
    editorOpen: value.editorOpen as boolean,
    viewerOpen: value.viewerOpen as boolean,
    parameterOpen: value.parameterOpen as boolean,
    consoleOpen: value.consoleOpen as boolean,
    dockWidth: value.dockWidth,
    viewerWidth: value.viewerWidth,
    parameterHeight: value.parameterHeight,
    consoleHeight: value.consoleHeight,
    maximized: null,
    narrowView: value.narrowView,
    narrowDockOpen: false,
    narrowSheet: null,
  });
}
