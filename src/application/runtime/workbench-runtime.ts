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
import { UNAVAILABLE_ARTIFACT_DESTINATION } from "../files/artifact-destination";
import { EPHEMERAL_RECENT_PROJECTS_PERSISTENCE } from "../files/recent-projects";
import {
  createProjectSessionState,
  executeProjectCommand,
  isProjectCommand,
  type ProjectSessionState,
} from "../files/project-session";
import { createProjectSnapshot, type ProjectFileContent } from "../files/project-snapshot";
import {
  createDefaultPersistedSettings,
  parsePersistedSettings,
  restoreSettingsSection,
  serializePersistedSettings,
} from "../settings/settings-codec";
import { EPHEMERAL_SETTINGS_PERSISTENCE } from "../settings/settings-persistence";
import {
  parseWorkspaceLayout,
  reduceWorkspaceLayout,
  serializeWorkspaceLayout,
  type WorkspaceLayoutAction,
  type WorkspaceLayoutState,
} from "../layout/workspace-layout";
import { createDeferredAction } from "./deferred-action";
import { summarizeLayoutAction } from "./layout-action-summary";
import { sameLayout } from "./same-layout";
import {
  createSettingsState,
  type SettingsState,
  settingsStateFromProfile,
} from "./render-settings";
import {
  EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE,
} from "./layout-persistence";
import { buildRuntimeRenderFileMap } from "./project-render-files";
import { applyProjectTransition } from "./project-transition";
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

export function createWorkbenchRuntime(engine: EngineService, options: RuntimeOptions = {}): WorkbenchRuntime {
  const layoutPersistence = options.layoutPersistence ?? EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE;
  const settingsPersistence = options.settingsPersistence ?? EPHEMERAL_SETTINGS_PERSISTENCE;
  const recentProjectsPersistence = options.recentProjectsPersistence
    ?? EPHEMERAL_RECENT_PROJECTS_PERSISTENCE;
  let persistedSettings = createDefaultPersistedSettings();
  const serializedSettings = settingsPersistence.load();
  if (serializedSettings !== null) {
    try {
      persistedSettings = parsePersistedSettings(serializedSettings);
    } catch {
      persistedSettings = createDefaultPersistedSettings();
    }
  }
  let durableSettingsProfile = persistedSettings;
  let settingsSaveTail = Promise.resolve();
  const initialWorkspace = options.initialScratchSource === undefined
    ? createDocumentWorkspace()
    : createDocumentWorkspace([{
        id: "document-main",
        path: options.initialScratchPath ?? "main.scad",
        source: options.initialScratchSource,
      }]);
  const initialProject = options.initialProject ?? createProjectSnapshot(
    "scratch",
    new Map(initialWorkspace.documents.map(({ path, source }) => [path, source])),
  );
  const documents = createStore<DocumentWorkspaceState>(() => initialWorkspace);
  let recentProjects = [] as ReturnType<typeof recentProjectsPersistence.load>;
  try {
    recentProjects = recentProjectsPersistence.load();
  } catch {
    recentProjects = [];
  }
  const project = createStore<ProjectSessionState>(() =>
    createProjectSessionState(
      initialProject,
      options.initialProject ? "project" : "scratch",
      undefined,
      recentProjects,
    )
  );
  const render = createStore<RenderState>(() => ({ status: "idle" }));
  const settings = createStore<SettingsState>(() =>
    createSettingsState(options.rendering, options.keybindings, persistedSettings)
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
      void dispatch({
        kind: "render-active",
        origin: "system",
        quality: settings.getState().defaultQuality,
      });
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

  async function replaceSettingsProfile(profile: SettingsState["profile"]): Promise<void> {
    const serialized = serializePersistedSettings(profile);
    const validated = parsePersistedSettings(serialized);
    const current = settings.getState();
    settings.setState(settingsStateFromProfile(validated, current.engineAvailable), true);
    const save = settingsSaveTail.then(async () => {
      await settingsPersistence.save(serialized);
      durableSettingsProfile = validated;
    });
    settingsSaveTail = save.catch(() => undefined);
    try {
      await save;
    } catch (error) {
      const latest = settings.getState();
      if (latest.profile === validated) {
        settings.setState(
          settingsStateFromProfile(durableSettingsProfile, latest.engineAvailable),
          true,
        );
      }
      throw error;
    }
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

  function sourceSnapshotIsCurrent(
    snapshot: ReadonlyMap<string, ProjectFileContent>,
    projectRevision: number,
  ): boolean {
    const current = documents.getState().documents;
    return project.getState().revision === projectRevision
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
      case "mark-document-autosaved":
        return {
          kind: "mark-saved",
          documentId: command.documentId,
          revision: command.revision,
          source: command.source,
        };
      case "resolve-external-change": {
        if (command.choice === "reload") {
          return {
            kind: "replace-from-disk",
            documentId: command.documentId,
            source: command.diskSource,
          };
        }
        const target = documents.getState().documents.find(({ id }) => id === command.documentId);
        return target
          ? {
              kind: "mark-saved",
              documentId: command.documentId,
              revision: target.revision,
              source: command.diskSource,
            }
          : null;
      }
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
      case "mark-document-autosaved":
        return `Autosave ${before.documents.find(({ id }) => id === command.documentId)?.path ?? command.documentId}`;
      case "resolve-external-change":
        return `${command.choice === "reload" ? "Reload" : "Keep local changes to"} ${
          before.documents.find(({ id }) => id === command.documentId)?.path ?? command.documentId
        }`;
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
    if (isProjectCommand(command)) {
      const beforeProject = project.getState();
      const beforeWorkspace = documents.getState();
      const transition = await executeProjectCommand(
        beforeProject,
        beforeWorkspace,
        command,
        { storage: options.projectStorage, makeDocumentId: makeId, now },
      );
      if (!transition) return;
      const currentProject = project.getState();
      if (
        currentProject !== beforeProject
        || currentProject.snapshot.projectId !== beforeProject.snapshot.projectId
        || currentProject.revision !== beforeProject.revision
      ) return;
      applyProjectTransition(transition, {
        documents,
        project,
        render,
        cancelActiveRender,
      });
      if (transition.project.recentProjects !== beforeProject.recentProjects) {
        try {
          recentProjectsPersistence.save(transition.project.recentProjects);
        } catch {
          // A metadata failure must not prevent an explicitly confirmed project open.
        }
      }
      record(command, makeId(), transition.summary, false);
      if (transition.project.revision !== beforeProject.revision) {
        cancelActiveRender();
        scheduleAutoRender();
      }
      return;
    }
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
      await replaceSettingsProfile({
        ...settings.getState().profile,
        theme: { ...settings.getState().profile.theme, preference: command.theme },
      });
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
      await replaceSettingsProfile({
        ...settings.getState().profile,
        rendering: { ...settings.getState().profile.rendering, autoRender: command.enabled },
      });
      if (!command.enabled) autoRenderTimer.clear();
      record(
        command,
        makeId(),
        command.enabled ? "Enable auto-render" : "Disable auto-render",
        false,
      );
      return;
    }

    if (command.kind === "replace-settings") {
      await replaceSettingsProfile(command.settings);
      record(command, makeId(), "Replace user settings", false);
      scheduleAutoRender();
      return;
    }

    if (command.kind === "restore-settings-section") {
      await replaceSettingsProfile(
        restoreSettingsSection(settings.getState().profile, command.section),
      );
      record(command, makeId(), `Restore ${command.section} settings`, false);
      scheduleAutoRender();
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
    const projectRevision = project.getState().revision;
    const sourceFiles = buildRuntimeRenderFileMap(project.getState(), workspace);
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
      projectRevision,
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
      projectRevision,
      result,
    }, true);
    const currentWorkspace = documents.getState();
    const currentTarget = currentWorkspace.documents.find(({ id }) => id === document.id);
    if (
      !currentTarget
      || currentTarget.path !== document.path
      || currentTarget.revision !== document.revision
      || currentWorkspace.activeDocumentId !== document.id
      || !sourceSnapshotIsCurrent(sourceFiles, projectRevision)
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
    artifacts: options.artifactDestination ?? UNAVAILABLE_ARTIFACT_DESTINATION,
    documents: readonlyStore(documents),
    render: readonlyStore(render),
    console: readonlyStore(runConsole),
    settings: readonlyStore(settings),
    layout: readonlyStore(layout),
    project: readonlyStore(project),
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
