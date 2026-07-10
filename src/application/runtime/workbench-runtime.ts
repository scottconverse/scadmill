import { createStore, type StoreApi } from "zustand/vanilla";

import {
  activeDocument,
  createDocumentWorkspace,
  reduceDocumentWorkspace,
  type DocumentSeed,
  type DocumentWorkspaceAction,
  type DocumentWorkspaceState,
} from "../documents/document-workspace";
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

export interface RenderState {
  status: "idle" | "rendering" | "success" | "failure";
  jobId?: string;
  quality?: Quality;
  documentId?: string;
  entryFile?: string;
  sourceRevision?: number;
  sourceFiles?: ReadonlyMap<string, string>;
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
  | { kind: "open-document"; origin: CommandOrigin; document: DocumentSeed }
  | { kind: "activate-document"; origin: CommandOrigin; documentId: string }
  | { kind: "edit-document"; origin: CommandOrigin; documentId: string; source: string }
  | { kind: "move-document"; origin: CommandOrigin; documentId: string; toIndex: number }
  | { kind: "close-document"; origin: CommandOrigin; documentId: string }
  | { kind: "reopen-document"; origin: CommandOrigin }
  | { kind: "set-theme"; origin: CommandOrigin; theme: ThemePreference }
  | { kind: "update-layout"; origin: CommandOrigin; action: WorkspaceLayoutAction }
  | { kind: "render-active"; origin: CommandOrigin; quality: Quality };

export interface ReadonlyStore<T> {
  getState(): T;
  getInitialState(): T;
  subscribe(listener: (state: T, previousState: T) => void): () => void;
}

export interface WorkbenchRuntime {
  documents: ReadonlyStore<DocumentWorkspaceState>;
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
  const documents = createStore<DocumentWorkspaceState>(() => createDocumentWorkspace());
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

  function sourceSnapshotIsCurrent(snapshot: ReadonlyMap<string, string>): boolean {
    const current = documents.getState().documents;
    return current.length === snapshot.size
      && current.every(({ path, source }) => snapshot.get(path) === source);
  }

  function documentAction(command: WorkbenchCommand): DocumentWorkspaceAction | null {
    switch (command.kind) {
      case "open-document":
        return { kind: "open", document: command.document };
      case "activate-document":
        return { kind: "activate", documentId: command.documentId };
      case "edit-document":
        return { kind: "edit", documentId: command.documentId, source: command.source };
      case "move-document":
        return { kind: "move", documentId: command.documentId, toIndex: command.toIndex };
      case "close-document":
        return { kind: "close", documentId: command.documentId };
      case "reopen-document":
        return { kind: "reopen" };
      default:
        return null;
    }
  }

  function summarizeDocumentCommand(
    command: WorkbenchCommand,
    before: DocumentWorkspaceState,
  ): string {
    switch (command.kind) {
      case "open-document":
        return `Open ${command.document.path}`;
      case "activate-document":
        return `Activate ${before.documents.find(({ id }) => id === command.documentId)?.path ?? command.documentId}`;
      case "edit-document":
        return `Edit ${before.documents.find(({ id }) => id === command.documentId)?.path ?? command.documentId}`;
      case "move-document":
        return `Move ${before.documents.find(({ id }) => id === command.documentId)?.path ?? command.documentId} to tab ${command.toIndex + 1}`;
      case "close-document":
        return `Close ${before.documents.find(({ id }) => id === command.documentId)?.path ?? command.documentId}`;
      case "reopen-document":
        return `Reopen ${before.recentlyClosed.at(-1)?.document.path ?? "document"}`;
      default:
        return "Update documents";
    }
  }

  async function dispatch(command: WorkbenchCommand): Promise<void> {
    const action = documentAction(command);
    if (action) {
      const before = documents.getState();
      const next = reduceDocumentWorkspace(before, action);
      if (next === before) return;
      documents.setState(next, true);
      record(
        command,
        makeId(),
        summarizeDocumentCommand(command, before),
        command.kind === "edit-document",
      );
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

    if (command.kind !== "render-active") {
      throw new Error(`Unhandled workbench command: ${command.kind}`);
    }

    const commandId = makeId();
    const workspace = documents.getState();
    const document = activeDocument(workspace);
    const sourceFiles = new Map(workspace.documents.map(({ path, source }) => [path, source]));
    const job = engine.render({
      entryFile: document.path,
      files: sourceFiles,
      parameters: {},
      quality: command.quality,
      timeoutMs: command.quality === "preview" ? 30_000 : 600_000,
    });
    render.setState({
      status: "rendering",
      jobId: job.jobId,
      quality: command.quality,
      documentId: document.id,
      entryFile: document.path,
      sourceRevision: document.revision,
      sourceFiles,
    }, true);
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
      documentId: document.id,
      entryFile: document.path,
      sourceRevision: document.revision,
      sourceFiles,
      result,
    }, true);
    const currentWorkspace = documents.getState();
    const currentTarget = currentWorkspace.documents.find(({ id }) => id === document.id);
    if (
      !currentTarget
      || currentTarget.path !== document.path
      || currentTarget.revision !== document.revision
      || currentWorkspace.activeDocumentId !== document.id
      || !sourceSnapshotIsCurrent(sourceFiles)
    ) {
      return;
    }
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
