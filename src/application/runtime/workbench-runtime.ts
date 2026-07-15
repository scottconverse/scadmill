import { createStore, type StoreApi } from "zustand/vanilla";
import { messages } from "../../messages/en";

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
import type { EngineService, ParamValue, Quality } from "../engine/contracts";
import { UNAVAILABLE_ARTIFACT_DESTINATION } from "../files/artifact-destination";
import { EPHEMERAL_RECENT_PROJECTS_PERSISTENCE } from "../files/recent-projects";
import {
  createProjectSessionState,
  executeProjectCommand,
  isProjectCommand,
  type ProjectSessionState,
} from "../files/project-session";
import { parseProjectPath } from "../files/project-path";
import { createProjectSnapshot, type ProjectFileContent } from "../files/project-snapshot";
import {
  createDefaultPersistedSettings,
  parsePersistedSettings,
  restoreSettingsSection,
  serializePersistedSettings,
} from "../settings/settings-codec";
import {
  EPHEMERAL_SETTINGS_PERSISTENCE,
  type SettingsPersistence,
} from "../settings/settings-persistence";
import {
  parseWorkspaceLayout,
  reduceWorkspaceLayout,
  serializeWorkspaceLayout,
  type WorkspaceLayoutAction,
  type WorkspaceLayoutState,
} from "../layout/workspace-layout";
import {
  createParameterState,
  type ParameterAction,
  type ParameterState,
  parameterDocument,
  parameterRecordsEqual,
  reduceParameterState,
} from "../parameters/parameter-state";
import { writeParameterValues } from "../parameters/parameter-overrides";
import {
  EPHEMERAL_WORKSPACE_METADATA_PERSISTENCE,
  WorkspaceAnnotationRepository,
} from "../viewer/annotation-persistence";
import {
  createViewerState,
  reduceViewerState,
  viewerDocument,
  type ViewerState,
} from "../viewer/viewer-state";
import { createDeferredAction } from "./deferred-action";
import { summarizeLayoutAction } from "./layout-action-summary";
import { sameLayout } from "./same-layout";
import {
  createSettingsState,
  type SettingsState,
  type SettingsPersistenceStatus,
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
  const artifacts = options.artifactDestination ?? UNAVAILABLE_ARTIFACT_DESTINATION;
  const layoutPersistence = options.layoutPersistence ?? EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE;
  const settingsPersistence = options.settingsPersistence ?? EPHEMERAL_SETTINGS_PERSISTENCE;
  const recentProjectsPersistence = options.recentProjectsPersistence
    ?? EPHEMERAL_RECENT_PROJECTS_PERSISTENCE;
  const annotationRepository = new WorkspaceAnnotationRepository(
    options.workspaceMetadataPersistence ?? EPHEMERAL_WORKSPACE_METADATA_PERSISTENCE,
  );
  let persistedSettings = createDefaultPersistedSettings();
  let settingsPersistenceStatus: SettingsPersistenceStatus = { status: "ready" };
  let loadedSettings: ReturnType<SettingsPersistence["load"]>;
  try {
    loadedSettings = settingsPersistence.load();
  } catch {
    loadedSettings = { kind: "error" };
  }
  if (loadedSettings.kind === "error") {
    settingsPersistenceStatus = { status: "load-error", reason: "read-error" };
  } else if (loadedSettings.kind === "loaded") {
    try {
      persistedSettings = parsePersistedSettings(loadedSettings.serializedSettings);
    } catch {
      settingsPersistenceStatus = { status: "load-error", reason: "invalid-data" };
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
    settingsStateFromProfile(
      createSettingsState(options.rendering, options.keybindings, persistedSettings).profile,
      false,
      settingsPersistenceStatus,
    )
  );
  const runConsole = createStore<ConsoleState>(() => createConsoleState());
  const annotationPersistence = createStore(() => annotationRepository.state());
  let activeWorkspaceIdentity = initialProject.workspaceIdentity;
  const layout = createStore<WorkspaceLayoutState>(() =>
    parseWorkspaceLayout(layoutPersistence.load(activeWorkspaceIdentity))
  );
  let initialViewer = createViewerState();
  for (const document of initialWorkspace.documents) {
    initialViewer = reduceViewerState(initialViewer, {
      kind: "replace-annotations",
      documentId: document.id,
      annotations: annotationRepository.annotations(initialProject.projectId, document.path),
    });
  }
  const viewer = createStore<ViewerState>(() => initialViewer);
  const parameters = createStore<ParameterState>(() =>
    createParameterState(initialWorkspace.documents.map((document) => ({
      documentId: document.id,
      revision: document.revision,
      source: document.source,
    })))
  );
  const history = createStore<readonly HistoryEntry[]>(() => []);
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  const nowMs = options.nowMs ?? (() => Date.now());
  let disposed = false;
  const pendingAutoRenders = new Map<string, Quality>();
  const autoRenderTimer = createDeferredAction(() => {
    if (disposed) return;
    const documentId = activeDocument(documents.getState()).id;
    const quality = pendingAutoRenders.get(documentId);
    if (quality === undefined) return;
    pendingAutoRenders.delete(documentId);
    void dispatch({ kind: "render-active", origin: "system", quality });
  });

  function cancelActiveRender(): void {
    const active = render.getState();
    if (active.status === "rendering" && active.jobId) engine.cancel(active.jobId);
  }

  function schedulePendingRenderForActiveDocument(): void {
    const current = settings.getState();
    if (disposed || !current.engineAvailable || !current.autoRender) {
      autoRenderTimer.clear();
      return;
    }
    const documentId = activeDocument(documents.getState()).id;
    if (!pendingAutoRenders.has(documentId)) {
      autoRenderTimer.clear();
      return;
    }
    autoRenderTimer.schedule(current.renderDebounceMs);
  }

  function scheduleAutoRender(
    quality: Quality = settings.getState().defaultQuality,
    documentId: string = activeDocument(documents.getState()).id,
  ): void {
    const current = settings.getState();
    if (disposed || !current.engineAvailable || !current.autoRender) {
      pendingAutoRenders.clear();
      autoRenderTimer.clear();
      return;
    }
    pendingAutoRenders.set(documentId, quality);
    if (documents.getState().activeDocumentId === documentId) {
      autoRenderTimer.schedule(current.renderDebounceMs);
    }
  }

  async function replaceSettingsProfile(profile: SettingsState["profile"]): Promise<void> {
    if (settingsPersistenceStatus.status === "load-error") {
      throw new Error("Settings were not loaded safely; existing settings were not changed.");
    }
    const serialized = serializePersistedSettings(profile);
    const validated = parsePersistedSettings(serialized);
    const current = settings.getState();
    settings.setState(
      settingsStateFromProfile(validated, current.engineAvailable, current.persistenceStatus),
      true,
    );
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
          settingsStateFromProfile(
            durableSettingsProfile,
            latest.engineAvailable,
            latest.persistenceStatus,
          ),
          true,
        );
      }
      throw error;
    }
  }

  function createHistoryEntry(
    command: WorkbenchCommand,
    commandId: string,
    summary: string,
    undoable: boolean,
  ): HistoryEntry {
    return {
      commandId,
      timestamp: now().toISOString(),
      origin: command.origin,
      kind: command.kind,
      summary,
      undoable,
    };
  }

  function appendHistory(entry: HistoryEntry): void {
    history.setState(
      (entries) => [...entries, entry],
      true,
    );
  }

  function record(command: WorkbenchCommand, commandId: string, summary: string, undoable: boolean): void {
    appendHistory(createHistoryEntry(command, commandId, summary, undoable));
  }

  function updateLayout(action: WorkspaceLayoutAction): boolean {
    const current = layout.getState();
    const next = reduceWorkspaceLayout(current, action);
    if (sameLayout(current, next)) {
      return false;
    }
    layout.setState(next, true);
    layoutPersistence.save(activeWorkspaceIdentity, serializeWorkspaceLayout(next));
    return true;
  }

  function sourceSnapshotIsCurrent(
    snapshot: ReadonlyMap<string, ProjectFileContent>,
    parameterSnapshot: Readonly<Record<string, ParamValue>>,
    documentId: string,
    projectRevision: number,
  ): boolean {
    const current = documents.getState().documents;
    const parameterState = parameters.getState().documents.get(documentId);
    return project.getState().revision === projectRevision
      && current.every(({ path, source }) => snapshot.get(path) === source)
      && Boolean(parameterState && parameterRecordsEqual(parameterState.overrides, parameterSnapshot));
  }

  function syncParameterDocuments(
    workspace: DocumentWorkspaceState,
    replaceDocumentIds: ReadonlySet<string> = new Set(),
  ): void {
    const before = parameters.getState();
    let next = before;
    const retainedDocumentIds = new Set([
      ...workspace.documents.map(({ id }) => id),
      ...workspace.recentlyClosed.map(({ document }) => document.id),
    ]);
    if ([...next.documents.keys()].some((id) => !retainedDocumentIds.has(id))) {
      next = {
        documents: new Map(
          [...next.documents].filter(([id]) => retainedDocumentIds.has(id)),
        ),
      };
    }
    for (const document of workspace.documents) {
      const current = next.documents.get(document.id);
      const replace = replaceDocumentIds.has(document.id);
      if (replace || !current || current.revision < document.revision) {
        next = reduceParameterState(next, {
          kind: "sync-source",
          documentId: document.id,
          revision: document.revision,
          source: document.source,
          replace,
        });
      }
    }
    if (next !== before) parameters.setState(next, true);
  }

  function engineParameterSnapshot(documentId: string): Record<string, ParamValue> {
    const snapshot: Record<string, ParamValue> = {};
    const overrides = parameterDocument(parameters.getState(), documentId).overrides;
    for (const [name, value] of Object.entries(overrides)) {
      Object.defineProperty(snapshot, name, {
        configurable: true,
        enumerable: true,
        value: Array.isArray(value) ? [...value] : value,
        writable: true,
      });
    }
    return snapshot;
  }

  function parameterActionAffectsRender(action: ParameterAction): boolean {
    return action.kind === "set-value"
      || action.kind === "reset-value"
      || action.kind === "reset-all"
      || action.kind === "apply-set"
      || action.kind === "clear-overrides";
  }

  function restoreWorkspaceAnnotations(): void {
    const projectId = project.getState().snapshot.projectId;
    let next = viewer.getState();
    for (const document of documents.getState().documents) {
      next = reduceViewerState(next, {
        kind: "replace-annotations",
        documentId: document.id,
        annotations: annotationRepository.annotations(projectId, document.path),
      });
    }
    viewer.setState(next, true);
  }

  function updateAnnotationPaths(
    command: WorkbenchCommand,
    projectId: string,
    workspace: DocumentWorkspaceState,
  ): void {
    try {
      switch (command.kind) {
        case "rename-project-file": {
          const source = parseProjectPath(command.path);
          const separator = source.lastIndexOf("/");
          const destination = parseProjectPath(
            separator < 0
              ? command.newName
              : `${source.slice(0, separator)}/${command.newName}`,
          );
          annotationRepository.move(projectId, source, destination);
          return;
        }
        case "move-project-file":
          annotationRepository.move(
            projectId,
            parseProjectPath(command.path),
            parseProjectPath(command.destinationPath),
          );
          return;
        case "save-document-as-confirmed": {
          const source = workspace.documents.find(({ id }) => id === command.documentId)?.path;
          if (source) {
            annotationRepository.copy(projectId, source, parseProjectPath(command.path));
          }
          return;
        }
        case "delete-project-file":
          annotationRepository.delete(projectId, parseProjectPath(command.path));
          return;
        default:
          return;
      }
    } catch {
      // File operations remain successful when optional workspace metadata cannot be saved.
    } finally {
      annotationPersistence.setState(annotationRepository.state(), true);
    }
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
      const projectChanged =
        currentProject !== beforeProject
        || currentProject.snapshot.projectId !== beforeProject.snapshot.projectId
        || currentProject.revision !== beforeProject.revision;
      const workspaceChanged = documents.getState() !== beforeWorkspace;
      if (projectChanged) {
        if (command.kind === "restore-recovery-confirmed") {
          throw new Error(messages.recoveryProjectStateChanged);
        }
        return;
      }
      if (command.kind === "restore-recovery-confirmed" && workspaceChanged) {
        throw new Error(messages.recoveryWorkspaceChanged);
      }
      const replacementLayout = transition.replacementWorkspace
        ? parseWorkspaceLayout(layoutPersistence.load(transition.project.snapshot.workspaceIdentity))
        : undefined;
      const historyEntry = createHistoryEntry(command, makeId(), transition.summary, false);
      applyProjectTransition(transition, {
        documents,
        parameters,
        project,
        render,
        viewer,
        cancelActiveRender,
        syncParameterDocuments,
      });
      if (transition.replacementWorkspace) {
        activeWorkspaceIdentity = transition.project.snapshot.workspaceIdentity;
        layout.setState(replacementLayout as WorkspaceLayoutState, true);
        pendingAutoRenders.clear();
        autoRenderTimer.clear();
      }
      updateAnnotationPaths(command, beforeProject.snapshot.projectId, beforeWorkspace);
      restoreWorkspaceAnnotations();
      if (transition.project.recentProjects !== beforeProject.recentProjects) {
        try {
          recentProjectsPersistence.save(transition.project.recentProjects);
        } catch {
          // A metadata failure must not prevent an explicitly confirmed project open.
        }
      }
      appendHistory(historyEntry);
      if (transition.project.revision !== beforeProject.revision) {
        cancelActiveRender();
        scheduleAutoRender();
      } else if (command.kind === "restore-recovery-confirmed") {
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
      syncParameterDocuments(
        next,
        command.kind === "open-document" && !before.documents.some(({ id }) => id === command.document.id)
          ? new Set([command.document.id])
          : undefined,
      );
      record(
        command,
        makeId(),
        summarizeDocumentCommand(command, before),
        command.kind === "edit-document",
      );
      for (const documentId of pendingAutoRenders.keys()) {
        if (!next.documents.some(({ id }) => id === documentId)) {
          pendingAutoRenders.delete(documentId);
        }
      }
      if (next.activeDocumentId !== before.activeDocumentId) {
        autoRenderTimer.clear();
        schedulePendingRenderForActiveDocument();
      }
      if (command.kind === "edit-document") {
        cancelActiveRender();
        scheduleAutoRender(undefined, command.documentId);
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
        pendingAutoRenders.clear();
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
      if (!command.enabled) {
        pendingAutoRenders.clear();
        autoRenderTimer.clear();
      }
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

    if (command.kind === "retry-annotation-persistence") {
      try {
        annotationRepository.retry();
      } catch {
        // The persistent error state remains visible and retryable.
      }
      annotationPersistence.setState(annotationRepository.state(), true);
      if (annotationRepository.state().status === "saved") restoreWorkspaceAnnotations();
      record(command, makeId(), "Retry annotation metadata persistence", false);
      return;
    }

    if (command.kind === "export-annotation-metadata") {
      await artifacts.save({
        suggestedName: "scadmill-annotations-v1.json",
        bytes: new TextEncoder().encode(annotationRepository.serializeCurrent()),
        mimeType: "application/json",
      });
      record(command, makeId(), "Export current annotation metadata", false);
      return;
    }

    if (command.kind === "update-layout") {
      if (!updateLayout(command.action)) {
        return;
      }
      record(command, makeId(), summarizeLayoutAction(command.action), false);
      return;
    }

    if (command.kind === "update-viewer") {
      const before = viewer.getState();
      const next = reduceViewerState(before, command.action);
      if (next === before) return;
      viewer.setState(next, true);
      if (
        command.action.kind === "add-annotation"
        || command.action.kind === "delete-annotation"
      ) {
        const document = documents.getState().documents.find(
          ({ id }) => id === command.action.documentId,
        );
        if (document) {
          try {
            annotationRepository.replace(
              project.getState().snapshot.projectId,
              document.path,
              viewerDocument(next, document.id).annotations,
            );
          } catch {
            // Keep the in-memory annotation usable when profile storage is unavailable.
          }
          annotationPersistence.setState(annotationRepository.state(), true);
        }
      }
      record(command, makeId(), `Update viewer for ${command.action.documentId}`, false);
      return;
    }

    if (command.kind === "update-parameters") {
      const before = parameters.getState();
      const next = reduceParameterState(before, command.action);
      if (next === before) return;
      parameters.setState(next, true);
      record(
        command,
        makeId(),
        `Update parameters for ${command.action.documentId}: ${command.action.kind}`,
        command.action.kind === "set-value",
      );
      if (parameterActionAffectsRender(command.action)) {
        cancelActiveRender();
        scheduleAutoRender("preview", command.action.documentId);
      }
      return;
    }

    if (command.kind === "write-parameter-values") {
      const workspace = documents.getState();
      const document = workspace.documents.find(({ id }) => id === command.documentId);
      if (!document) return;
      const parameterState = parameterDocument(parameters.getState(), command.documentId);
      const source = writeParameterValues(
        document.source,
        parameterState.parameters,
        parameterState.overrides,
      );
      if (source === document.source) return;
      const nextWorkspace = reduceDocumentWorkspace(workspace, {
        kind: "edit",
        documentId: document.id,
        source,
      });
      documents.setState(nextWorkspace, true);
      syncParameterDocuments(nextWorkspace);
      parameters.setState(reduceParameterState(parameters.getState(), {
        kind: "clear-overrides",
        documentId: document.id,
      }), true);
      record(command, makeId(), `Write parameter values into ${document.path}`, true);
      cancelActiveRender();
      scheduleAutoRender("preview", command.documentId);
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
    pendingAutoRenders.delete(document.id);
    const projectRevision = project.getState().revision;
    const sourceFiles = buildRuntimeRenderFileMap(project.getState(), workspace);
    const parameterValues = engineParameterSnapshot(document.id);
    const rendering = settings.getState();
    const startedMs = nowMs();
    const startedAt = now();
    const startedAtMonotonicMs = performance.now();
    const job = engine.render({
      entryFile: document.path,
      files: sourceFiles,
      parameters: parameterValues,
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
      startedAt: startedAt.toISOString(),
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
      startedAtMs: startedAt.getTime(),
      startedAtMonotonicMs,
      quality: command.quality,
      documentId: document.id,
      entryFile: document.path,
      sourceRevision: document.revision,
      sourceFiles,
      projectRevision,
      parameterValues,
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
      parameterValues,
      result,
    }, true);
    const currentWorkspace = documents.getState();
    const currentTarget = currentWorkspace.documents.find(({ id }) => id === document.id);
    if (
      !currentTarget
      || currentTarget.path !== document.path
      || currentTarget.revision !== document.revision
      || !sourceSnapshotIsCurrent(sourceFiles, parameterValues, document.id, projectRevision)
    ) {
      return;
    }
    if (result.kind !== "failure") {
      viewer.setState(reduceViewerState(viewer.getState(), {
        kind: "present-result",
        documentId: document.id,
        modelIdentity: job.jobId,
        quality: command.quality,
        result,
      }), true);
    }
    if (currentWorkspace.activeDocumentId !== document.id) return;
    updateLayout({
      kind: result.kind === "failure" && result.reason !== "cancelled"
        ? "render-failed"
        : "render-succeeded",
      jobId: job.jobId,
    });
  }

  return {
    artifacts,
    documents: readonlyStore(documents),
    render: readonlyStore(render),
    console: readonlyStore(runConsole),
    settings: readonlyStore(settings),
    layout: readonlyStore(layout),
    viewer: readonlyStore(viewer),
    annotationPersistence: readonlyStore(annotationPersistence),
    parameters: readonlyStore(parameters),
    project: readonlyStore(project),
    history: readonlyStore(history),
    dispatch,
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingAutoRenders.clear();
      autoRenderTimer.clear();
      cancelActiveRender();
    },
  };
}
