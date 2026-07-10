import { createStore, type StoreApi } from "zustand/vanilla";

import type { EngineService, Quality, RenderResult } from "../engine/contracts";
import type { ThemePreference } from "../theme/theme-runtime";

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
  history: ReadonlyStore<readonly HistoryEntry[]>;
  dispatch(command: WorkbenchCommand): Promise<void>;
}

export interface RuntimeOptions {
  makeId?: () => string;
  now?: () => Date;
}

function readonlyStore<T>(store: StoreApi<T>): ReadonlyStore<T> {
  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,
  };
}

export function createWorkbenchRuntime(engine: EngineService, options: RuntimeOptions = {}): WorkbenchRuntime {
  const documents = createStore<DocumentState>(() => ({ path: "main.scad", source: "cube(10);", dirty: false }));
  const render = createStore<RenderState>(() => ({ status: "idle" }));
  const settings = createStore<SettingsState>(() => ({ theme: "system" }));
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
  }

  return {
    documents: readonlyStore(documents),
    render: readonlyStore(render),
    settings: readonlyStore(settings),
    history: readonlyStore(history),
    dispatch,
  };
}
