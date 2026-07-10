import { createStore, type StoreApi } from "zustand/vanilla";

import {
  createConsoleState,
  reduceConsoleState,
  type ConsoleState,
} from "../diagnostics/console-state";
import {
  activeDocument,
  createDocumentWorkspace,
  reduceDocumentWorkspace,
  type DocumentWorkspaceAction,
  type DocumentWorkspaceState,
} from "../documents/document-workspace";
import type { EngineService } from "../engine/contracts";
import {
  parseWorkspaceLayout,
  reduceWorkspaceLayout,
  serializeWorkspaceLayout,
  type WorkspaceLayoutAction,
  type WorkspaceLayoutState,
} from "../layout/workspace-layout";
import { createDeferredAction } from "./deferred-action";
import { sameLayout } from "./same-layout";
import {
  createSettingsState,
  type SettingsState,
} from "./render-settings";
import {
  EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE,
} from "./layout-persistence";
import type {
  HistoryEntry,
  ReadonlyStore,
  RenderState,
  RuntimeOptions,
  WorkbenchCommand,
  WorkbenchRuntime,
} from "./workbench-runtime-contracts";

export type { SettingsState } from "./render-settings";
export type {
  CommandOrigin,
  HistoryEntry,
  ReadonlyStore,
  RenderState,
  RuntimeOptions,
  WorkbenchCommand,
  WorkbenchRuntime,
} from "./workbench-runtime-contracts";

function readonlyStore<T>(store: StoreApi<T>): ReadonlyStore<T> {
  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
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
  const settings = createStore<SettingsState>(() =>
    createSettingsState(options.rendering, options.keybindings)
  );
  const runConsole = createStore<ConsoleState>(() => createConsoleState());
  const layout = createStore<WorkspaceLayoutState>(() => parseWorkspaceLayout(layoutPersistence.load()));
  const history = createStore<readonly HistoryEntry[]>(() => []);
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  const nowMs = options.nowMs ?? (() => Date.now());
  let disposed = false;
  const autoRenderTimer = createDeferredAction(() => {
    if (!disposed) {
      void dispatch({ kind: "render-active", origin: "system", quality: "preview" });
    }
  });

  function cancelActiveRender(): void {
    const active = render.getState();
    if (active.status === "rendering" && active.jobId) engine.cancel(active.jobId);
  }

  function scheduleAutoRender(): void {
    const current = settings.getState();
    if (disposed || !current.engineAvailable || !current.autoRender) {
      autoRenderTimer.clear();
      return;
    }
    autoRenderTimer.schedule(current.renderDebounceMs);
  }

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
      if (command.kind === "edit-document") {
        cancelActiveRender();
        scheduleAutoRender();
      }
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

    if (command.kind === "engine-availability-changed") {
      settings.setState({ engineAvailable: command.available });
      if (!command.available) {
        autoRenderTimer.clear();
        cancelActiveRender();
      }
      return;
    }

    if (command.kind === "set-auto-render") {
      if (settings.getState().autoRender === command.enabled) return;
      settings.setState({ autoRender: command.enabled });
      if (!command.enabled) autoRenderTimer.clear();
      record(
        command,
        makeId(),
        command.enabled ? "Enable auto-render" : "Disable auto-render",
        false,
      );
      return;
    }

    if (command.kind === "cancel-render") {
      const active = render.getState();
      if (active.status !== "rendering" || !active.jobId) return;
      engine.cancel(active.jobId);
      record(command, makeId(), `Cancel render ${active.entryFile ?? active.jobId}`, false);
      return;
    }

    if (command.kind === "editor-command") {
      const summary = command.outcome.status === "unavailable"
        ? `Editor command unavailable: ${command.outcome.command}`
        : `Editor command: ${command.outcome.command}`;
      record(command, makeId(), summary, false);
      return;
    }

    if (command.kind === "clear-console") {
      runConsole.setState(reduceConsoleState(runConsole.getState(), { kind: "clear" }), true);
      record(command, makeId(), "Clear console", false);
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

    autoRenderTimer.clear();
    cancelActiveRender();
    const commandId = makeId();
    const workspace = documents.getState();
    const document = activeDocument(workspace);
    const sourceFiles = new Map(workspace.documents.map(({ path, source }) => [path, source]));
    const rendering = settings.getState();
    const startedMs = nowMs();
    const job = engine.render({
      entryFile: document.path,
      files: sourceFiles,
      parameters: {},
      quality: command.quality,
      timeoutMs: command.quality === "preview"
        ? rendering.previewTimeoutMs
        : rendering.fullTimeoutMs,
      ...(command.quality === "preview"
        ? { previewFacetLimit: rendering.previewFacetLimit }
        : {}),
    });
    runConsole.setState(reduceConsoleState(runConsole.getState(), {
      kind: "start-run",
      jobId: job.jobId,
      entryFile: document.path,
      quality: command.quality,
      startedAt: now().toISOString(),
    }), true);
    const unsubscribeOutput = typeof job.subscribeOutput === "function"
      ? job.subscribeOutput((event) => {
          runConsole.setState(reduceConsoleState(runConsole.getState(), {
            kind: "append-output",
            jobId: job.jobId,
            event,
          }), true);
        })
      : () => undefined;
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
    unsubscribeOutput();
    runConsole.setState(reduceConsoleState(runConsole.getState(), {
      kind: "finish-run",
      jobId: job.jobId,
      durationMs: Math.max(0, nowMs() - startedMs),
      result,
    }), true);
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
    console: readonlyStore(runConsole),
    settings: readonlyStore(settings),
    layout: readonlyStore(layout),
    history: readonlyStore(history),
    dispatch,
    dispose() {
      if (disposed) return;
      disposed = true;
      autoRenderTimer.clear();
      cancelActiveRender();
    },
  };
}
