import { createStore, type StoreApi } from "zustand/vanilla";

import type { EngineService, Quality, RenderResult } from "../engine/contracts";
import {
  parseWorkspaceLayout,
  reduceWorkspaceLayout,
  serializeWorkspaceLayout,
  type WorkspaceLayoutAction,
  type WorkspaceLayoutState,
} from "../layout/workspace-layout";
import type { ThemePreference } from "../theme/theme-runtime";
import {
  EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE,
  type WorkspaceLayoutPersistence,
} from "./layout-persistence";

export type CommandOrigin = "user" | "ai-panel" | "external-agent";

export interface DocumentState {
  path: string;
  source: string;
  dirty: boolean;
}

export interface RenderState {
  status: "idle" | "rendering" | "success" | "failure";
  jobId?: string;
  quality?: Quality;
  result?: RenderResult;
}

export interface SettingsState {
  theme: ThemePreference;
}

export interface HistoryEntry {
  commandId: string;
  timestamp: string;
  origin: CommandOrigin;
  kind: WorkbenchCommand["kind"];
  summary: string;
  undoable: boolean;
}

export type WorkbenchCommand =
  | { kind: "edit-document"; origin: CommandOrigin; source: string }
  | { kind: "set-theme"; origin: CommandOrigin; theme: ThemePreference }
  | { kind: "update-layout"; origin: CommandOrigin; action: WorkspaceLayoutAction }
  | { kind: "render-active"; origin: CommandOrigin; quality: Quality };

export interface ReadonlyStore<T> {
  getState(): T;
  getInitialState(): T;
  subscribe(listener: (state: T, previousState: T) => void): () => void;
}

export interface WorkbenchRuntime {
  documents: ReadonlyStore<DocumentState>;
  render: ReadonlyStore<RenderState>;
  settings: ReadonlyStore<SettingsState>;
  layout: ReadonlyStore<WorkspaceLayoutState>;
  history: ReadonlyStore<readonly HistoryEntry[]>;
  dispatch(command: WorkbenchCommand): Promise<void>;
}

export interface RuntimeOptions {
  makeId?: () => string;
  now?: () => Date;
  layoutPersistence?: WorkspaceLayoutPersistence;
}

function readonlyStore<T>(store: StoreApi<T>): ReadonlyStore<T> {
  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}

function sameLayout(left: WorkspaceLayoutState, right: WorkspaceLayoutState): boolean {
  return left.activeRail === right.activeRail
    && left.dockOpen === right.dockOpen
    && left.editorOpen === right.editorOpen
    && left.viewerOpen === right.viewerOpen
    && left.parameterOpen === right.parameterOpen
    && left.consoleOpen === right.consoleOpen
    && left.dockWidth === right.dockWidth
    && left.viewerWidth === right.viewerWidth
    && left.parameterHeight === right.parameterHeight
    && left.consoleHeight === right.consoleHeight
    && left.maximized === right.maximized
    && left.narrowView === right.narrowView
    && left.narrowDockOpen === right.narrowDockOpen
    && left.narrowSheet === right.narrowSheet
    && left.consoleAutoOpenedForJobId === right.consoleAutoOpenedForJobId;
}

function summarizeLayoutAction(action: WorkspaceLayoutAction): string {
  switch (action.kind) {
    case "activate-rail":
      return `Activate ${action.panel} rail`;
    case "resize-panel":
      return `Resize ${action.panel}`;
    case "toggle-panel":
      return `Toggle ${action.panel}`;
    case "toggle-maximize":
      return `Toggle ${action.region} maximize`;
    case "set-narrow-view":
      return `Show ${action.view} view`;
    case "set-narrow-sheet":
      return action.sheet === null ? "Close narrow sheet" : `Show ${action.sheet} sheet`;
    case "close-narrow-dock":
      return "Close narrow dock";
    case "render-failed":
      return "Open console for render failure";
    case "render-succeeded":
      return "Keep layout after render success";
    case "reset-layout":
      return "Reset workspace layout";
  }
}

export function createWorkbenchRuntime(engine: EngineService, options: RuntimeOptions = {}): WorkbenchRuntime {
  const layoutPersistence = options.layoutPersistence ?? EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE;
  const documents = createStore<DocumentState>(() => ({ path: "main.scad", source: "cube(10);", dirty: false }));
  const render = createStore<RenderState>(() => ({ status: "idle" }));
  const settings = createStore<SettingsState>(() => ({ theme: "system" }));
  const layout = createStore<WorkspaceLayoutState>(() => parseWorkspaceLayout(layoutPersistence.load()));
  const history = createStore<readonly HistoryEntry[]>(() => []);
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? (() => new Date());

  function record(command: WorkbenchCommand, commandId: string, summary: string, undoable: boolean): void {
    history.setState(
      (entries) => [
        ...entries,
        {
          commandId,
          timestamp: now().toISOString(),
          origin: command.origin,
          kind: command.kind,
          summary,
          undoable,
        },
      ],
      true,
    );
  }

  function updateLayout(action: WorkspaceLayoutAction): boolean {
    const current = layout.getState();
    const next = reduceWorkspaceLayout(current, action);
    if (sameLayout(current, next)) {
      return false;
    }
    layout.setState(next, true);
    layoutPersistence.save(serializeWorkspaceLayout(next));
    return true;
  }

  async function dispatch(command: WorkbenchCommand): Promise<void> {
    if (command.kind === "edit-document") {
      const commandId = makeId();
      const document = documents.getState();
      documents.setState({ ...document, source: command.source, dirty: true });
      record(command, commandId, `Edit ${document.path}`, true);
      return;
    }

    if (command.kind === "set-theme") {
      if (settings.getState().theme === command.theme) {
        return;
      }
      const commandId = makeId();
      settings.setState({ theme: command.theme });
      const label = command.theme === "high-contrast"
        ? "High contrast"
        : `${command.theme[0].toUpperCase()}${command.theme.slice(1)}`;
      record(command, commandId, `Switch theme to ${label}`, false);
      return;
    }

    if (command.kind === "update-layout") {
      if (!updateLayout(command.action)) {
        return;
      }
      record(command, makeId(), summarizeLayoutAction(command.action), false);
      return;
    }

    const commandId = makeId();
    const document = documents.getState();
    const job = engine.render({
      entryFile: document.path,
      files: new Map([[document.path, document.source]]),
      parameters: {},
      quality: command.quality,
      timeoutMs: command.quality === "preview" ? 30_000 : 600_000,
    });
    render.setState({ status: "rendering", jobId: job.jobId, quality: command.quality });
    record(
      command,
      commandId,
      `Render ${document.path} at ${command.quality} quality`,
      false,
    );

    const result = await job.done;
    if (render.getState().jobId !== job.jobId) {
      return;
    }
    render.setState({
      status: result.kind === "failure" ? "failure" : "success",
      jobId: job.jobId,
      quality: command.quality,
      result,
    });
    updateLayout({
      kind: result.kind === "failure" && result.reason !== "cancelled"
        ? "render-failed"
        : "render-succeeded",
      jobId: job.jobId,
    });
  }

  return {
    documents: readonlyStore(documents),
    render: readonlyStore(render),
    settings: readonlyStore(settings),
    layout: readonlyStore(layout),
    history: readonlyStore(history),
    dispatch,
  };
}
