import { createStore, type StoreApi } from "zustand/vanilla";
import { messages } from "../../messages/en";

import {
  type ConsoleState,
  createConsoleState,
  reduceConsoleState,
  restoreClearedConsoleState,
} from "../diagnostics/console-state";
import {
  activeDocument,
  createDocumentWorkspace,
  type DocumentWorkspaceAction,
  type DocumentWorkspaceState,
  reduceDocumentWorkspace,
} from "../documents/document-workspace";
import type { EngineInfo, EngineService, ParamValue, Quality, RenderRequest } from "../engine/contracts";
import { cachedEngineVersion } from "../engine/engine-version-cache";
import { UNAVAILABLE_ARTIFACT_DESTINATION } from "../files/artifact-destination";
import { parseProjectPath } from "../files/project-path";
import {
  createProjectSessionState,
  executeProjectCommand,
  isProjectCommand,
  type ProjectSessionState,
} from "../files/project-session";
import { createProjectSnapshot, type ProjectFileContent } from "../files/project-snapshot";
import { EPHEMERAL_RECENT_PROJECTS_PERSISTENCE } from "../files/recent-projects";
import { ensureGeometryIdentity } from "../geometry/geometry-identity";
import {
  parseWorkspaceLayout,
  reduceWorkspaceLayout,
  serializeWorkspaceLayout,
  type WorkspaceLayoutAction,
  type WorkspaceLayoutState,
} from "../layout/workspace-layout";
import {
  EPHEMERAL_MODEL_HISTORY_PERSISTENCE,
  type ModelHistoryPersistenceState,
  ModelHistoryTimeline,
  type ModelHistorySnapshot,
} from "../model-history/model-history";
import { writeParameterValues } from "../parameters/parameter-overrides";
import {
  createParameterState,
  type ParameterAction,
  type ParameterDocumentState,
  type ParameterState,
  parameterDocument,
  parameterRecordsEqual,
  reduceParameterState,
} from "../parameters/parameter-state";
import type { CacheableRenderResult, CachedRenderResult, RenderCache } from "../render-cache/render-cache";
import {
  createRenderCacheKey,
  RenderCacheKeyIndex,
  RenderMemoryCache,
  TieredRenderCache,
} from "../render-cache/render-cache";
import { EPHEMERAL_RENDER_DISK_CACHE_PREFERENCES } from "../render-cache/render-cache-preference";
import { RenderDiskCache } from "../render-cache/render-disk-cache";
import { EPHEMERAL_RENDER_THUMBNAIL_PERSISTENCE, type RenderThumbnailPersistence } from "../render-cache/render-thumbnail-persistence";
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
  EPHEMERAL_WORKSPACE_METADATA_PERSISTENCE,
  WorkspaceAnnotationRepository,
} from "../viewer/annotation-persistence";
import {
  createViewerState,
  reduceViewerState,
  type ViewerState,
  viewerDocument,
} from "../viewer/viewer-state";
import { createDeferredAction } from "./deferred-action";
import { summarizeLayoutAction } from "./layout-action-summary";
import {
  EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE,
} from "./layout-persistence";
import { projectFileHistoryStep } from "./project-file-history";
import { buildRuntimeRenderFileMap } from "./project-render-files";
import { applyProjectTransition } from "./project-transition";
import {
  createSettingsState,
  type SettingsPersistenceStatus,
  type SettingsState,
  settingsStateFromProfile,
} from "./render-settings";
import { sameLayout } from "./same-layout";
import {
  createWorkbenchControlState,
  reduceWorkbenchControlState,
  type WorkbenchControlAction,
  type WorkbenchControlState,
} from "./workbench-controls";
import type {
  HistoryEntry,
  HistoryDetail,
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
  HistoryDetail,
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
  const renderDiskCachePreferences = options.renderDiskCachePreferencePersistence
    ?? EPHEMERAL_RENDER_DISK_CACHE_PREFERENCES;
  const renderThumbnails: RenderThumbnailPersistence = options.renderThumbnailPersistence
    ?? EPHEMERAL_RENDER_THUMBNAIL_PERSISTENCE;
  const modelHistoryPersistenceService = options.modelHistoryPersistence
    ?? EPHEMERAL_MODEL_HISTORY_PERSISTENCE;
  let showWelcomeOnLaunch = false;
  try {
    showWelcomeOnLaunch = options.welcomePreferencePersistence?.load() ?? false;
  } catch {
    showWelcomeOnLaunch = false;
  }
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
  const loadDiskCachePreference = (mode: ProjectSessionState["mode"], workspaceIdentity: string) => {
    if (mode !== "project") return false;
    try { return renderDiskCachePreferences.load(workspaceIdentity); } catch { return false; }
  };
  const project = createStore<ProjectSessionState>(() =>
    createProjectSessionState(
      initialProject,
      options.initialProject ? "project" : "scratch",
      undefined,
      recentProjects,
      loadDiskCachePreference(options.initialProject ? "project" : "scratch", initialProject.workspaceIdentity),
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
  const historyDetails = createStore<ReadonlyMap<string, HistoryDetail>>(() => new Map());
  const modelHistory = createStore<readonly ModelHistorySnapshot[]>(() => []);
  const modelHistoryTimeline = new ModelHistoryTimeline();
  let modelHistorySequence = 0;
  const initialModelHistorySupported = modelHistoryPersistenceService.supportsWorkspace(
    initialProject.workspaceIdentity,
  );
  const initialModelHistoryEnabled = initialModelHistorySupported
    && modelHistoryPersistenceService.isEnabled(initialProject.workspaceIdentity);
  const modelHistoryPersistence = createStore<ModelHistoryPersistenceState>(() => ({
    supported: initialModelHistorySupported,
    enabled: initialModelHistoryEnabled,
    status: "ready",
  }));
  if (initialModelHistoryEnabled) {
    try {
      for (const snapshot of modelHistoryPersistenceService.load(initialProject.workspaceIdentity)) {
        modelHistoryTimeline.capture(snapshot);
        if (snapshot.thumbnailPng) {
          modelHistoryTimeline.attachThumbnail(
            snapshot.workspaceIdentity,
            snapshot.snapshotId,
            snapshot.thumbnailPng,
          );
        }
      }
      modelHistory.setState(modelHistoryTimeline.listAll(), true);
    } catch {
      modelHistoryPersistence.setState({
        supported: initialModelHistorySupported,
        enabled: initialModelHistoryEnabled,
        status: "error",
      }, true);
    }
  }
  const controls = createStore<WorkbenchControlState>(() =>
    createWorkbenchControlState(showWelcomeOnLaunch)
  );
  interface ReversibleHistoryFrame {
    readonly undo: () => void | Promise<void>;
    readonly redo: () => void | Promise<void>;
  }
  const undoFrames: ReversibleHistoryFrame[] = [];
  const redoFrames: ReversibleHistoryFrame[] = [];
  interface CommandOrderSlot {
    readonly command: WorkbenchCommand;
    frame?: ReversibleHistoryFrame;
    entry?: HistoryEntry;
    detail?: HistoryDetail;
    completed: boolean;
  }
  const commandOrderSlots: CommandOrderSlot[] = [];
  const commandSlots = new WeakMap<object, CommandOrderSlot>();
  let historyGeneration = 0;
  interface ProjectRuntimeHistoryState {
    readonly project: ProjectSessionState;
    readonly workspace: DocumentWorkspaceState;
    readonly parameters: ParameterState;
    readonly viewer: ViewerState;
    readonly layout: WorkspaceLayoutState;
    readonly workspaceIdentity: string;
    readonly annotationMetadata: string;
  }
  const makeId = options.makeId ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  const nowMs = options.nowMs ?? (() => Date.now());
  const renderDiskCache = options.renderDiskCacheStorage
    ? new RenderDiskCache(options.renderDiskCacheStorage)
    : undefined;
  const renderCache: RenderCache | null = options.renderCache === null
    ? null
    : options.renderCache
      ?? (renderDiskCache
        ? new TieredRenderCache(
            new RenderMemoryCache(),
            renderDiskCache,
            () => project.getState().mode === "project"
              && project.getState().diskRenderCacheEnabled,
          )
        : new RenderMemoryCache());
  let engineInfoPromise: Promise<EngineInfo | null> | undefined;
  let resolvedEngineInfo: EngineInfo | null | undefined;
  const knownCacheKeys = new RenderCacheKeyIndex();
  const presentedCacheKeys = new WeakMap<CacheableRenderResult, string>();
  let renderAttemptGeneration = 0;
  let activeAnimationCommand: WorkbenchCommand | undefined;
  let disposed = false;
  const pendingCommands = new Set<Promise<void>>();
  const pendingProjectCommands = new Set<Promise<void>>();
  let exclusiveCommandTail: Promise<void> | undefined;
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
    renderAttemptGeneration += 1;
    const active = render.getState();
    if (active.status === "rendering" && active.jobId) engine.cancel(active.jobId);
  }

  function engineInfoForCache(): Promise<EngineInfo | null> {
    engineInfoPromise ??= cachedEngineVersion(engine, settings.getState().profile.engine.executablePath)
      .then((info) => {
        resolvedEngineInfo = info ?? null;
        return resolvedEngineInfo;
      })
      .catch(() => null);
    return engineInfoPromise;
  }

  // Warm the engine identity as soon as a desktop disk tier exists so a
  // first cold render can usually derive its key without starting the engine
  // on the render critical path.
  if (renderCache?.requiresColdLookup) void engineInfoForCache();

  function renderMemoKey(
    workspace: DocumentWorkspaceState,
    projectRevision: number,
    workspaceIdentity: string,
    documentId: string,
    request: RenderRequest,
    engineInfo: EngineInfo,
    configuredEnginePath: string,
  ): string {
    return JSON.stringify({
      workspaceIdentity,
      projectRevision,
      documentId,
      documents: workspace.documents
        .map(({ id, path, revision }) => ({ id, path, revision }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      entryFile: request.entryFile,
      parameters: Object.entries(request.parameters).sort(([left], [right]) => left.localeCompare(right)),
      quality: request.quality,
      previewFacetLimit: request.quality === "preview" ? request.previewFacetLimit ?? null : null,
      engine: {
        ...engineInfo,
        features: [...engineInfo.features].sort(),
        configuredEnginePath,
      },
    });
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
    if (disposed || !current.autoRender) {
      pendingAutoRenders.clear();
      autoRenderTimer.clear();
      return;
    }
    pendingAutoRenders.set(documentId, quality);
    if (!current.engineAvailable) {
      autoRenderTimer.clear();
      return;
    }
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
    const enginePathChanged = current.profile.engine.executablePath
      !== validated.engine.executablePath;
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
      if (enginePathChanged) {
        engineInfoPromise = undefined;
        resolvedEngineInfo = undefined;
      }
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

  function appendHistoryNow(entry: HistoryEntry): void {
    historyGeneration += 1;
    redoFrames.length = 0;
    history.setState(
      (entries) => [...entries, entry],
      true,
    );
  }

  function flushCompletedCommandSlots(): void {
    while (commandOrderSlots[0]?.completed) {
      const slot = commandOrderSlots.shift() as CommandOrderSlot;
      if (slot.frame) undoFrames.push(slot.frame);
      const { detail, entry } = slot;
      if (entry) {
        if (detail) {
          historyDetails.setState(
            (current) => new Map(current).set(entry.commandId, detail),
            true,
          );
        }
        appendHistoryNow(entry);
      }
      commandSlots.delete(slot.command);
    }
  }

  function completeCommandSlot(slot: CommandOrderSlot | undefined): void {
    if (!slot) return;
    slot.completed = true;
    flushCompletedCommandSlots();
  }

  function stageHistory(
    command: WorkbenchCommand,
    entry: HistoryEntry,
    detail?: HistoryDetail,
  ): void {
    const slot = commandSlots.get(command);
    if (slot) {
      slot.entry = entry;
      slot.detail = detail;
    } else {
      if (detail) {
        historyDetails.setState(
          (current) => new Map(current).set(entry.commandId, detail),
          true,
        );
      }
      appendHistoryNow(entry);
    }
  }

  function record(
    command: WorkbenchCommand,
    commandId: string,
    summary: string,
    undoable: boolean,
    detail?: HistoryDetail,
  ): void {
    stageHistory(command, createHistoryEntry(command, commandId, summary, undoable), detail);
  }

  function pushReversibleFrame(
    command: WorkbenchCommand,
    frame: ReversibleHistoryFrame,
  ): void {
    const slot = commandSlots.get(command);
    if (slot) slot.frame = frame;
    else undoFrames.push(frame);
  }

  function clearReversibleHistory(): void {
    undoFrames.length = 0;
    redoFrames.length = 0;
  }

  function replaceParameterDocument(
    documentId: string,
    replacement: ParameterDocumentState | undefined,
  ): void {
    const current = parameters.getState();
    const nextDocuments = new Map(current.documents);
    const workspaceDocument = documents.getState().documents.find(({ id }) => id === documentId);
    if (replacement) {
      nextDocuments.set(documentId, workspaceDocument
        ? { ...replacement, revision: workspaceDocument.revision }
        : replacement);
    }
    else nextDocuments.delete(documentId);
    parameters.setState({ documents: nextDocuments }, true);
  }

  function replayDocumentEdit(
    documentId: string,
    source: string,
    parameterDocumentState: ParameterDocumentState | undefined,
    quality?: Quality,
  ): void {
    const before = documents.getState();
    const next = reduceDocumentWorkspace(before, { kind: "edit", documentId, source });
    if (next === before) return;
    documents.setState(next, true);
    replaceParameterDocument(documentId, parameterDocumentState);
    cancelActiveRender();
    scheduleAutoRender(quality, documentId);
  }

  function replayWorkspaceState(
    workspace: DocumentWorkspaceState,
    parameterState: ParameterState,
  ): void {
    documents.setState(workspace, true);
    parameters.setState(parameterState, true);
    for (const documentId of pendingAutoRenders.keys()) {
      if (!workspace.documents.some(({ id }) => id === documentId)) {
        pendingAutoRenders.delete(documentId);
      }
    }
    autoRenderTimer.clear();
    cancelActiveRender();
    schedulePendingRenderForActiveDocument();
  }

  function replayParameterState(
    documentId: string,
    parameterDocumentState: ParameterDocumentState,
    affectsRender = true,
  ): void {
    replaceParameterDocument(documentId, parameterDocumentState);
    if (affectsRender) {
      cancelActiveRender();
      scheduleAutoRender("preview", documentId);
    }
  }

  async function replaySettingsProfile(profile: SettingsState["profile"]): Promise<void> {
    await replaceSettingsProfile(profile);
    scheduleAutoRender();
  }

  function replayLayoutState(state: WorkspaceLayoutState): void {
    layoutPersistence.save(activeWorkspaceIdentity, serializeWorkspaceLayout(state));
    layout.setState(state, true);
  }

  function replayViewerState(state: ViewerState): void {
    viewer.setState(state, true);
    const projectId = project.getState().snapshot.projectId;
    for (const document of documents.getState().documents) {
      try {
        annotationRepository.replace(
          projectId,
          document.path,
          viewerDocument(state, document.id).annotations,
        );
      } catch {
        // Preserve the reversible in-memory state when optional metadata persistence fails.
      }
    }
    annotationPersistence.setState(annotationRepository.state(), true);
  }

  function replayWorkbenchControls(
    state: WorkbenchControlState,
    persistWelcomePreference: boolean,
  ): void {
    if (persistWelcomePreference) {
      options.welcomePreferencePersistence?.save(state.showWelcomeOnLaunch);
    }
    controls.setState(state, true);
  }

  function updateWorkbenchControls(
    command: WorkbenchCommand,
    action: WorkbenchControlAction,
    reversible: boolean,
  ): boolean {
    const before = controls.getState();
    const next = reduceWorkbenchControlState(before, action);
    if (next === before) return false;
    if (action.kind === "set-welcome-on-launch") {
      options.welcomePreferencePersistence?.save(action.enabled);
    }
    controls.setState(next, true);
    const persistsWelcomePreference = action.kind === "set-welcome-on-launch";
    if (reversible) {
      pushReversibleFrame(command, {
        undo: () => replayWorkbenchControls(before, persistsWelcomePreference),
        redo: () => replayWorkbenchControls(next, persistsWelcomePreference),
      });
    }
    return true;
  }

  function captureProjectRuntimeHistoryState(): ProjectRuntimeHistoryState {
    return {
      project: project.getState(),
      workspace: documents.getState(),
      parameters: parameters.getState(),
      viewer: viewer.getState(),
      layout: layout.getState(),
      workspaceIdentity: activeWorkspaceIdentity,
      annotationMetadata: annotationRepository.serializeCurrent(),
    };
  }

  function replayProjectRuntimeHistoryState(state: ProjectRuntimeHistoryState): void {
    cancelActiveRender();
    pendingAutoRenders.clear();
    autoRenderTimer.clear();
    activeWorkspaceIdentity = state.workspaceIdentity;
    project.setState(state.project, true);
    documents.setState(state.workspace, true);
    parameters.setState(state.parameters, true);
    viewer.setState(state.viewer, true);
    layout.setState(state.layout, true);
    render.setState({ status: "idle" }, true);
    try {
      annotationRepository.restore(state.annotationMetadata);
    } catch {
      // Preserve the reversible in-memory repository when optional metadata persistence fails.
    }
    annotationPersistence.setState(annotationRepository.state(), true);
    activateModelHistoryWorkspace(state.workspaceIdentity);
    try {
      recentProjectsPersistence.save(state.project.recentProjects);
    } catch {
      // Optional recent-project metadata must not break a reversible project command.
    }
  }

  function updateLayout(action: WorkspaceLayoutAction): boolean {
    const current = layout.getState();
    const next = reduceWorkspaceLayout(current, action);
    if (sameLayout(current, next)) {
      return false;
    }
    layoutPersistence.save(activeWorkspaceIdentity, serializeWorkspaceLayout(next));
    layout.setState(next, true);
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

  function captureModelHistory(
    commandIdentity: string,
    workspaceIdentity: string,
    document: DocumentWorkspaceState["documents"][number],
    quality: Quality,
    parameterValues: Readonly<Record<string, ParamValue>>,
    result: CacheableRenderResult,
  ): string {
    const capturedAt = now().toISOString();
    let snapshotId: string;
    do {
      snapshotId = `${commandIdentity}:model-history:${capturedAt}:${++modelHistorySequence}`;
    } while (modelHistoryTimeline.get(workspaceIdentity, snapshotId));
    const renderIdentity = result.kind === "2d"
      ? result.geometryIdentity
      : result.mesh.geometryIdentity;
    modelHistoryTimeline.capture({
      snapshotId,
      workspaceIdentity,
      documentId: document.id,
      documentPath: parseProjectPath(document.path),
      renderIdentity: renderIdentity ?? snapshotId,
      capturedAt,
      quality,
      source: document.source,
      parameters: parameterValues,
    });
    modelHistory.setState(modelHistoryTimeline.listAll(), true);
    persistModelHistory(workspaceIdentity);
    return snapshotId;
  }

  function modelHistoryPersistenceState(workspaceIdentity: string): ModelHistoryPersistenceState {
    const supported = modelHistoryPersistenceService.supportsWorkspace(workspaceIdentity);
    return {
      supported,
      enabled: supported && modelHistoryPersistenceService.isEnabled(workspaceIdentity),
      status: "ready",
    };
  }

  function persistModelHistory(workspaceIdentity: string): void {
    const state = modelHistoryPersistence.getState();
    if (!state.supported || !state.enabled) return;
    try {
      modelHistoryPersistenceService.save(
        workspaceIdentity,
        modelHistoryTimeline.listWorkspace(workspaceIdentity),
      );
      if (state.status !== "ready") {
        modelHistoryPersistence.setState({ ...state, status: "ready" }, true);
      }
    } catch {
      modelHistoryPersistence.setState({ ...state, status: "error" }, true);
    }
  }

  function activateModelHistoryWorkspace(workspaceIdentity: string): void {
    let state: ModelHistoryPersistenceState;
    try {
      state = modelHistoryPersistenceState(workspaceIdentity);
      if (state.enabled) {
        for (const snapshot of modelHistoryPersistenceService.load(workspaceIdentity)) {
          if (modelHistoryTimeline.get(workspaceIdentity, snapshot.snapshotId)) continue;
          modelHistoryTimeline.capture(snapshot);
          if (snapshot.thumbnailPng) {
            modelHistoryTimeline.attachThumbnail(
              workspaceIdentity,
              snapshot.snapshotId,
              snapshot.thumbnailPng,
            );
          }
        }
        modelHistory.setState(modelHistoryTimeline.listAll(), true);
      }
    } catch {
      const supported = modelHistoryPersistenceService.supportsWorkspace(workspaceIdentity);
      state = { supported, enabled: false, status: "error" };
    }
    modelHistoryPersistence.setState(state, true);
  }

  function parameterActionAffectsRender(action: ParameterAction): boolean {
    return action.kind === "set-value"
      || action.kind === "set-values"
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

  function dispatch(command: WorkbenchCommand): Promise<void> {
    if (command.kind === "render-active") {
      const pending = executeCommand(command);
      return command.animationTime === undefined
        ? pending
        : pending.finally(() => {
            if (activeAnimationCommand === command) activeAnimationCommand = undefined;
          });
    }
    if (command.kind === "cancel-render" || command.kind === "cancel-animation") {
      return executeCommand(command);
    }
    const ordered = command.kind !== "history-undo" && command.kind !== "history-redo";
    const slot = ordered
      ? { command, completed: false } satisfies CommandOrderSlot
      : undefined;
    if (slot) {
      commandOrderSlots.push(slot);
      commandSlots.set(command, slot);
    }
    const exclusive = command.kind === "history-undo"
      || command.kind === "history-redo";
    if (exclusiveCommandTail || exclusive) {
      const pending = exclusiveCommandTail
        ? exclusiveCommandTail.then(() => executeCommand(command))
        : pendingCommands.size === 0
          ? executeCommand(command)
          : Promise.all([...pendingCommands].map((current) => current.catch(() => undefined)))
            .then(() => executeCommand(command));
      const tracked = pending.finally(() => completeCommandSlot(slot));
      const tail = tracked.catch(() => undefined);
      exclusiveCommandTail = tail;
      return tracked.finally(() => {
        if (exclusiveCommandTail === tail) exclusiveCommandTail = undefined;
      });
    }
    const projectCommand = isProjectCommand(command);
    const waitsForProjectTransition = !projectCommand && pendingProjectCommands.size > 0;
    const execution = waitsForProjectTransition
      ? Promise.all([...pendingProjectCommands].map((current) => current.catch(() => undefined)))
        .then(() => executeCommand(command))
      : executeCommand(command);
    const blocksLaterMutations = projectCommand
      && command.kind !== "restore-recovery-confirmed";
    let tracked: Promise<void>;
    tracked = execution.finally(() => {
      pendingCommands.delete(tracked);
      pendingProjectCommands.delete(tracked);
      completeCommandSlot(slot);
    });
    pendingCommands.add(tracked);
    if (blocksLaterMutations) pendingProjectCommands.add(tracked);
    return tracked;
  }

  async function executeCommand(command: WorkbenchCommand): Promise<void> {
    if (command.kind === "history-undo") {
      const frame = undoFrames.pop();
      if (!frame) return;
      const generation = historyGeneration;
      try {
        await frame.undo();
        if (historyGeneration === generation) redoFrames.push(frame);
      } catch (error) {
        if (historyGeneration === generation) undoFrames.push(frame);
        throw error;
      }
      return;
    }

    if (command.kind === "history-redo") {
      const frame = redoFrames.pop();
      if (!frame) return;
      const generation = historyGeneration;
      try {
        await frame.redo();
        if (historyGeneration === generation) undoFrames.push(frame);
      } catch (error) {
        if (historyGeneration === generation) redoFrames.push(frame);
        throw error;
      }
      return;
    }

    if (isProjectCommand(command)) {
      const beforeProject = project.getState();
      const beforeWorkspace = documents.getState();
      const beforeRuntime = captureProjectRuntimeHistoryState();
      const fileHistory = projectFileHistoryStep(
        command,
        beforeProject,
        beforeWorkspace,
        options.projectStorage,
      );
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
      const projectIdentityChanged = transition.project.mode !== beforeProject.mode
        || transition.project.snapshot.workspaceIdentity !== beforeProject.snapshot.workspaceIdentity;
      const effectiveTransition = projectIdentityChanged
        ? {
            ...transition,
            project: {
              ...transition.project,
              diskRenderCacheEnabled: loadDiskCachePreference(
                transition.project.mode,
                transition.project.snapshot.workspaceIdentity,
              ),
            },
          }
        : transition;
      const replacementLayout = effectiveTransition.replacementWorkspace
        ? parseWorkspaceLayout(layoutPersistence.load(transition.project.snapshot.workspaceIdentity))
        : undefined;
      const undoable = command.kind !== "reveal-project-file" && command.kind !== "refresh-project";
      const historyEntry = createHistoryEntry(command, makeId(), transition.summary, undoable);
      applyProjectTransition(effectiveTransition, {
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
      if (projectIdentityChanged) {
        activateModelHistoryWorkspace(transition.project.snapshot.workspaceIdentity);
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
      if (undoable) {
        const nextRuntime = captureProjectRuntimeHistoryState();
        pushReversibleFrame(command, {
          undo: async () => {
            await fileHistory?.undo();
            replayProjectRuntimeHistoryState(beforeRuntime);
          },
          redo: async () => {
            await fileHistory?.redo();
            replayProjectRuntimeHistoryState(nextRuntime);
          },
        });
      } else if (command.kind === "refresh-project") {
        clearReversibleHistory();
      }
      stageHistory(command, historyEntry);
      if (transition.project.revision !== beforeProject.revision) {
        cancelActiveRender();
        scheduleAutoRender();
      } else if (command.kind === "restore-recovery-confirmed") {
        cancelActiveRender();
        scheduleAutoRender();
      }
      return;
    }

    if (command.kind === "set-project-disk-render-cache") {
      const current = project.getState();
      if (current.mode !== "project") {
        throw new Error("Disk render caching is available only for opened projects.");
      }
      if (!renderDiskCache) throw new Error("Desktop render caching is unavailable.");
      renderDiskCachePreferences.save(current.snapshot.workspaceIdentity, command.enabled);
      const next = { ...current, diskRenderCacheEnabled: command.enabled };
      project.setState(next, true);
      const replayPreference = (state: ProjectSessionState) => {
        renderDiskCachePreferences.save(
          state.snapshot.workspaceIdentity,
          state.diskRenderCacheEnabled,
        );
        project.setState(state, true);
      };
      pushReversibleFrame(command, {
        undo: () => replayPreference(current),
        redo: () => replayPreference(next),
      });
      record(command, makeId(), command.enabled
        ? "Enable disk render cache for this project"
        : "Disable disk render cache for this project", true);
      return;
    }

    if (command.kind === "clear-project-disk-render-cache") {
      const current = project.getState();
      if (current.mode !== "project") {
        throw new Error("Disk render caching is available only for opened projects.");
      }
      if (!renderDiskCache) throw new Error("Desktop render caching is unavailable.");
      await renderDiskCache.clear(current.snapshot.workspaceIdentity);
      record(command, makeId(), "Clear disk render cache for this project", false);
      return;
    }
    if (command.kind === "attach-model-history-thumbnail") {
      if (modelHistoryTimeline.attachThumbnail(
        command.workspaceIdentity,
        command.snapshotId,
        command.pngBytes,
      )) {
        modelHistory.setState(modelHistoryTimeline.listAll(), true);
        persistModelHistory(command.workspaceIdentity);
      }
      return;
    }
    if (command.kind === "set-project-model-history-persistence") {
      const workspaceIdentity = project.getState().snapshot.workspaceIdentity;
      if (!modelHistoryPersistenceService.supportsWorkspace(workspaceIdentity)) {
        throw new Error("Persistent model history is unavailable for this workspace.");
      }
      try {
        modelHistoryPersistenceService.setEnabled(workspaceIdentity, command.enabled);
        modelHistoryPersistence.setState({
          supported: true,
          enabled: command.enabled,
          status: "ready",
        }, true);
        if (command.enabled) persistModelHistory(workspaceIdentity);
      } catch (error) {
        modelHistoryPersistence.setState({
          supported: true,
          enabled: modelHistoryPersistence.getState().enabled,
          status: "error",
        }, true);
        throw error;
      }
      record(
        command,
        makeId(),
        command.enabled ? "Keep model history for this project" : "Use session-only model history",
        false,
      );
      return;
    }
    if (command.kind === "restore-model-history-snapshot") {
      const workspaceIdentity = project.getState().snapshot.workspaceIdentity;
      const snapshot = modelHistoryTimeline.get(workspaceIdentity, command.snapshotId);
      if (!snapshot) throw new Error(`Unknown model history snapshot: ${command.snapshotId}.`);
      const beforeWorkspace = documents.getState();
      const beforeParameters = parameters.getState();
      const target = beforeWorkspace.documents.find(({ id }) => id === snapshot.documentId)
        ?? beforeWorkspace.documents.find(({ path }) => parseProjectPath(path) === snapshot.documentPath);
      if (!target) throw new Error(`Model history document is not open: ${snapshot.documentPath}.`);
      const nextWorkspace = reduceDocumentWorkspace(beforeWorkspace, {
        kind: "edit",
        documentId: target.id,
        source: snapshot.source,
      });
      documents.setState(nextWorkspace, true);
      syncParameterDocuments(nextWorkspace);
      let nextParameters = parameters.getState();
      nextParameters = reduceParameterState(nextParameters, {
        kind: "clear-overrides",
        documentId: target.id,
      });
      nextParameters = reduceParameterState(nextParameters, {
        kind: "set-values",
        documentId: target.id,
        values: snapshot.parameters,
      });
      parameters.setState(nextParameters, true);
      const afterWorkspace = documents.getState();
      const afterParameters = parameters.getState();
      pushReversibleFrame(command, {
        undo: () => replayWorkspaceState(beforeWorkspace, beforeParameters),
        redo: () => replayWorkspaceState(afterWorkspace, afterParameters),
      });
      record(
        command,
        makeId(),
        `Restore model history for ${snapshot.documentPath}`,
        true,
        {
          kind: "source-diff",
          path: snapshot.documentPath,
          before: target.source,
          after: snapshot.source,
        },
      );
      cancelActiveRender();
      scheduleAutoRender("preview", target.id);
      return;
    }
    const action = documentAction(command);
    if (action) {
      const before = documents.getState();
      const beforeParameters = parameters.getState();
      const beforeParameterDocument = command.kind === "edit-document"
        ? parameters.getState().documents.get(command.documentId)
        : undefined;
      const next = reduceDocumentWorkspace(before, action);
      if (next === before) return;
      documents.setState(next, true);
      syncParameterDocuments(
        next,
        command.kind === "open-document" && !before.documents.some(({ id }) => id === command.document.id)
          ? new Set([command.document.id])
          : undefined,
      );
      const commandId = makeId();
      const summary = summarizeDocumentCommand(command, before);
      const undoable = command.kind !== "mark-document-autosaved";
      if (command.kind === "edit-document") {
        const beforeSource = before.documents.find(({ id }) => id === command.documentId)?.source;
        const afterParameterDocument = parameters.getState().documents.get(command.documentId);
        if (beforeSource !== undefined) {
          pushReversibleFrame(command, {
            undo: () => replayDocumentEdit(
              command.documentId,
              beforeSource,
              beforeParameterDocument,
            ),
            redo: () => replayDocumentEdit(
              command.documentId,
              command.source,
              afterParameterDocument,
            ),
          });
        }
      } else if (command.kind !== "mark-document-autosaved") {
        const nextParameters = parameters.getState();
        pushReversibleFrame(command, {
          undo: () => replayWorkspaceState(before, beforeParameters),
          redo: () => replayWorkspaceState(next, nextParameters),
        });
      }
      const detail = command.kind === "edit-document"
        ? {
            kind: "source-diff" as const,
            path: before.documents.find(({ id }) => id === command.documentId)?.path
              ?? command.documentId,
            before: before.documents.find(({ id }) => id === command.documentId)?.source ?? "",
            after: command.source,
          }
        : undefined;
      record(command, commandId, summary, undoable, detail);
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
      const beforeProfile = settings.getState().profile;
      const commandId = makeId();
      await replaceSettingsProfile({
        ...settings.getState().profile,
        theme: { ...settings.getState().profile.theme, preference: command.theme },
      });
      const label = command.theme === "high-contrast"
        ? "High contrast"
        : `${command.theme[0].toUpperCase()}${command.theme.slice(1)}`;
      const nextProfile = settings.getState().profile;
      pushReversibleFrame(command, {
        undo: () => replaySettingsProfile(beforeProfile),
        redo: () => replaySettingsProfile(nextProfile),
      });
      record(command, commandId, `Switch theme to ${label}`, true);
      return;
    }

    if (command.kind === "engine-availability-changed") {
      engineInfoPromise = undefined;
      resolvedEngineInfo = undefined;
      settings.setState({ engineAvailable: command.available });
      if (!command.available) {
        autoRenderTimer.clear();
        cancelActiveRender();
      } else {
        schedulePendingRenderForActiveDocument();
      }
      return;
    }

    if (command.kind === "set-auto-render") {
      if (settings.getState().autoRender === command.enabled) return;
      const beforeProfile = settings.getState().profile;
      await replaceSettingsProfile({
        ...settings.getState().profile,
        rendering: { ...settings.getState().profile.rendering, autoRender: command.enabled },
      });
      if (!command.enabled) {
        pendingAutoRenders.clear();
        autoRenderTimer.clear();
      }
      const nextProfile = settings.getState().profile;
      pushReversibleFrame(command, {
        undo: () => replaySettingsProfile(beforeProfile),
        redo: () => replaySettingsProfile(nextProfile),
      });
      record(
        command,
        makeId(),
        command.enabled ? "Enable auto-render" : "Disable auto-render",
        true,
      );
      return;
    }

    if (command.kind === "set-welcome-on-launch") {
      const reversible = command.origin !== "system";
      if (!updateWorkbenchControls(command, {
        kind: "set-welcome-on-launch",
        enabled: command.enabled,
      }, reversible)) return;
      record(
        command,
        makeId(),
        command.enabled ? "Show Welcome on launch" : "Hide Welcome on launch",
        reversible,
      );
      return;
    }

    if (command.kind === "set-mcp-enabled") {
      const reversible = command.origin !== "system";
      if (!updateWorkbenchControls(
        command,
        { kind: "set-mcp-enabled", enabled: command.enabled },
        reversible,
      )) return;
      record(
        command,
        makeId(),
        command.enabled ? "Enable MCP server" : "Disable MCP server",
        reversible,
      );
      return;
    }

    if (command.kind === "set-mcp-permission") {
      const reversible = command.origin !== "system";
      if (!updateWorkbenchControls(command, {
        kind: "set-mcp-permission",
        tool: command.tool,
        permission: command.permission,
      }, reversible)) return;
      record(
        command,
        makeId(),
        `Set MCP ${command.tool} permission to ${command.permission}`,
        reversible,
      );
      return;
    }

    if (command.kind === "replace-settings") {
      const beforeProfile = settings.getState().profile;
      await replaceSettingsProfile(command.settings);
      const nextProfile = settings.getState().profile;
      pushReversibleFrame(command, {
        undo: () => replaySettingsProfile(beforeProfile),
        redo: () => replaySettingsProfile(nextProfile),
      });
      record(command, makeId(), "Replace user settings", true);
      scheduleAutoRender();
      return;
    }

    if (command.kind === "restore-settings-section") {
      const beforeProfile = settings.getState().profile;
      await replaceSettingsProfile(
        restoreSettingsSection(settings.getState().profile, command.section),
      );
      const nextProfile = settings.getState().profile;
      pushReversibleFrame(command, {
        undo: () => replaySettingsProfile(beforeProfile),
        redo: () => replaySettingsProfile(nextProfile),
      });
      record(command, makeId(), `Restore ${command.section} settings`, true);
      scheduleAutoRender();
      return;
    }

    if (command.kind === "cancel-animation") {
      if (activeAnimationCommand === undefined) return;
      activeAnimationCommand = undefined;
      cancelActiveRender();
      return;
    }

    if (command.kind === "cancel-render") {
      const active = render.getState();
      if (active.status !== "rendering" || !active.jobId) return;
      activeAnimationCommand = undefined;
      cancelActiveRender();
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
      const before = runConsole.getState();
      const next = reduceConsoleState(before, { kind: "clear" });
      if (next === before) return;
      runConsole.setState(next, true);
      pushReversibleFrame(command, {
        undo: () => runConsole.setState(
          restoreClearedConsoleState(runConsole.getState(), before),
          true,
        ),
        redo: () => runConsole.setState(
          reduceConsoleState(runConsole.getState(), { kind: "clear" }),
          true,
        ),
      });
      record(command, makeId(), "Clear console", true);
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
      const before = layout.getState();
      if (!updateLayout(command.action)) {
        return;
      }
      const next = layout.getState();
      pushReversibleFrame(command, {
        undo: () => replayLayoutState(before),
        redo: () => replayLayoutState(next),
      });
      record(command, makeId(), summarizeLayoutAction(command.action), true);
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
      pushReversibleFrame(command, {
        undo: () => replayViewerState(before),
        redo: () => replayViewerState(next),
      });
      record(command, makeId(), `Update viewer for ${command.action.documentId}`, true);
      return;
    }

    if (command.kind === "update-parameters") {
      const before = parameters.getState();
      const next = reduceParameterState(before, command.action);
      if (next === before) return;
      parameters.setState(next, true);
      const undoable = command.action.kind !== "sync-source";
      if (undoable) {
        const beforeDocument = before.documents.get(command.action.documentId);
        const nextDocument = next.documents.get(command.action.documentId);
        if (beforeDocument && nextDocument) {
          const affectsRender = parameterActionAffectsRender(command.action);
          pushReversibleFrame(command, {
            undo: () => replayParameterState(
              command.action.documentId,
              beforeDocument,
              affectsRender,
            ),
            redo: () => replayParameterState(
              command.action.documentId,
              nextDocument,
              affectsRender,
            ),
          });
        }
      } else {
        clearReversibleHistory();
      }
      record(
        command,
        makeId(),
        `Update parameters for ${command.action.documentId}: ${command.action.kind}`,
        undoable,
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
      const beforeParameterDocument = parameterState;
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
      const afterParameterDocument = parameters.getState().documents.get(command.documentId);
      if (afterParameterDocument) {
        pushReversibleFrame(command, {
          undo: () => replayDocumentEdit(
            command.documentId,
            document.source,
            beforeParameterDocument,
            "preview",
          ),
          redo: () => replayDocumentEdit(
            command.documentId,
            source,
            afterParameterDocument,
            "preview",
          ),
        });
      }
      record(command, makeId(), `Write parameter values into ${document.path}`, true);
      cancelActiveRender();
      scheduleAutoRender("preview", command.documentId);
      return;
    }

    if (command.kind !== "render-active") {
      throw new Error(`Unhandled workbench command: ${command.kind}`);
    }

    if (command.animationTime !== undefined) {
      if (!Number.isFinite(command.animationTime)
        || command.animationTime < 0
        || command.animationTime > 1) {
        throw new Error("Animation time must be between 0 and 1.");
      }
      if (command.quality !== "preview") {
        throw new Error("Animation frames must use preview quality.");
      }
    }

    autoRenderTimer.clear();
    cancelActiveRender();
    activeAnimationCommand = command.animationTime === undefined ? undefined : command;
    const renderAttempt = renderAttemptGeneration;
    const commandId = makeId();
    const workspace = documents.getState();
    const document = activeDocument(workspace);
    pendingAutoRenders.delete(document.id);
    const projectState = project.getState();
    const projectRevision = projectState.revision;
    const sourceFiles = buildRuntimeRenderFileMap(projectState, workspace);
    const parameterValues = engineParameterSnapshot(document.id);
    const requestParameterValues = command.animationTime === undefined
      ? parameterValues
      : { ...parameterValues, $t: command.animationTime };
    const rendering = settings.getState();
    const request: RenderRequest = {
      entryFile: document.path,
      files: sourceFiles,
      parameters: requestParameterValues,
      quality: command.quality,
      timeoutMs: command.quality === "preview"
        ? rendering.previewTimeoutMs
        : rendering.fullTimeoutMs,
      ...(command.quality === "preview"
        ? { previewFacetLimit: rendering.previewFacetLimit }
      : {}),
    };
    const snapshotIsCurrent = () => {
      const currentWorkspace = documents.getState();
      const currentTarget = currentWorkspace.documents.find(({ id }) => id === document.id);
      return Boolean(
        currentTarget
        && currentTarget.path === document.path
        && currentTarget.revision === document.revision
        && sourceSnapshotIsCurrent(
          sourceFiles,
          parameterValues,
          document.id,
          projectRevision,
        ),
      );
    };
    const requiresColdLookup = renderCache?.requiresColdLookup === true;
    if (renderCache && !requiresColdLookup) void engineInfoForCache();
    let memoKey = renderCache && resolvedEngineInfo
      ? renderMemoKey(
          workspace,
          projectRevision,
          projectState.snapshot.workspaceIdentity,
          document.id,
          request,
          resolvedEngineInfo,
          rendering.profile.engine.executablePath,
        )
      : undefined;
    let knownKey = memoKey ? knownCacheKeys.get(memoKey) : undefined;
    if (renderCache && requiresColdLookup && !knownKey) {
      const engineInfo = await engineInfoForCache();
      if (engineInfo && renderAttempt === renderAttemptGeneration && snapshotIsCurrent()) {
        knownKey = await createRenderCacheKey(
          request,
          engineInfo,
          rendering.profile.engine.executablePath,
        );
        memoKey = knownKey ? renderMemoKey(
          workspace,
          projectRevision,
          projectState.snapshot.workspaceIdentity,
          document.id,
          request,
          engineInfo,
          rendering.profile.engine.executablePath,
        ) : undefined;
        if (memoKey && knownKey) knownCacheKeys.set(memoKey, knownKey);
      }
    }
    const currentRender = render.getState();
    const currentPresentation = viewer.getState().documents.get(document.id)?.presentation;
    const canReusePresentedResult = Boolean(
      renderCache
      && knownKey
      && renderAttempt === renderAttemptGeneration
      && snapshotIsCurrent()
      && currentRender.status === "success"
      && currentRender.quality === command.quality
      && currentRender.documentId === document.id
      && currentRender.entryFile === document.path
      && currentRender.sourceRevision === document.revision
      && currentRender.projectRevision === projectRevision
      && currentRender.result
      && currentRender.result.kind !== "failure"
      && currentRender.result === currentPresentation?.result
      && presentedCacheKeys.get(currentRender.result) === knownKey
      && renderCache.touch?.(projectState.snapshot.workspaceIdentity, knownKey),
    );
    if (canReusePresentedResult) {
      let modelHistorySnapshotId = commandId;
      if (command.animationTime === undefined) {
        modelHistorySnapshotId = captureModelHistory(
          commandId,
          projectState.snapshot.workspaceIdentity,
          document,
          command.quality,
          parameterValues,
          currentRender.result as CacheableRenderResult,
        );
        record(
          command,
          commandId,
          `Render ${document.path} at ${command.quality} quality`,
          false,
        );
      }
      render.setState({
        ...currentRender,
        cached: true,
        presentationToken: modelHistorySnapshotId,
      }, true);
      viewer.setState(reduceViewerState(viewer.getState(), {
        kind: "present-result",
        documentId: document.id,
        modelIdentity: modelHistorySnapshotId,
        quality: command.quality,
        result: currentRender.result as CacheableRenderResult,
      }), true);
      return;
    }
    let cachedResult: CachedRenderResult | undefined;
    if (renderCache && knownKey) {
      try {
        cachedResult = await renderCache.get(projectState.snapshot.workspaceIdentity, knownKey);
      } catch {
        cachedResult = undefined;
      }
      if (!cachedResult && memoKey) knownCacheKeys.delete(memoKey);
    }
    if (renderAttempt !== renderAttemptGeneration || !snapshotIsCurrent()) return;
    if (cachedResult && knownKey) {
      const cacheJobId = `cache:${commandId}`;
      presentedCacheKeys.set(cachedResult.result, knownKey);
      let modelHistorySnapshotId = commandId;
      if (command.animationTime === undefined) {
        modelHistorySnapshotId = captureModelHistory(
          commandId,
          projectState.snapshot.workspaceIdentity,
          document,
          command.quality,
          parameterValues,
          cachedResult.result,
        );
        record(
          command,
          commandId,
          `Render ${document.path} at ${command.quality} quality`,
          false,
        );
      }
      render.setState({
        status: "success",
        cached: true,
        quality: command.quality,
        documentId: document.id,
        entryFile: document.path,
        sourceRevision: document.revision,
        sourceFiles,
        projectRevision,
        parameterValues,
        result: cachedResult.result,
        presentationToken: modelHistorySnapshotId,
      }, true);
      viewer.setState(reduceViewerState(viewer.getState(), {
        kind: "present-result",
        documentId: document.id,
        modelIdentity: modelHistorySnapshotId,
        quality: command.quality,
        result: cachedResult.result,
      }), true);
      if (documents.getState().activeDocumentId === document.id) {
        updateLayout({ kind: "render-succeeded", jobId: cacheJobId });
      }
      return;
    }
    const startedMs = nowMs();
    const startedAt = now();
    const startedAtMonotonicMs = performance.now();
    const job = engine.render(request);
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
    if (command.animationTime === undefined) {
      record(
        command,
        commandId,
        `Render ${document.path} at ${command.quality} quality`,
        false,
      );
    }

    const rawResult = await job.done;
    unsubscribeOutput();
    runConsole.setState(reduceConsoleState(runConsole.getState(), {
      kind: "finish-run",
      jobId: job.jobId,
      durationMs: Math.max(0, nowMs() - startedMs),
      result: rawResult,
    }), true);
    if (render.getState().jobId !== job.jobId) {
      return;
    }
    const result = snapshotIsCurrent()
      ? await ensureGeometryIdentity(rawResult)
      : rawResult;
    if (render.getState().jobId !== job.jobId) return;
    let successfulPresentationToken = commandId;
    const publishCompletedRender = () => {
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
        cached: false,
        presentationToken: result.kind === "failure" ? undefined : successfulPresentationToken,
      }, true);
    };
    if (result.kind === "failure") {
      publishCompletedRender();
      if (!snapshotIsCurrent() || renderAttempt !== renderAttemptGeneration) return;
      if (documents.getState().activeDocumentId === document.id) {
        updateLayout({
          kind: result.reason !== "cancelled" ? "render-failed" : "render-succeeded",
          jobId: job.jobId,
        });
      }
      return;
    }
    if (!snapshotIsCurrent() || renderAttempt !== renderAttemptGeneration) {
      publishCompletedRender();
      return;
    }

    let modelHistorySnapshotId = commandId;
    if (command.animationTime === undefined) {
      modelHistorySnapshotId = captureModelHistory(
        commandId,
        projectState.snapshot.workspaceIdentity,
        document,
        command.quality,
        parameterValues,
        result,
      );
    }
    successfulPresentationToken = modelHistorySnapshotId;

    const engineInfo = renderCache ? await engineInfoForCache() : null;
    const cacheKey = engineInfo
      ? await createRenderCacheKey(request, engineInfo, rendering.profile.engine.executablePath)
      : undefined;
    if (render.getState().jobId !== job.jobId) return;
    if (!snapshotIsCurrent() || renderAttempt !== renderAttemptGeneration) {
      publishCompletedRender();
      return;
    }
    const presentationJobId = modelHistorySnapshotId;
    viewer.setState(reduceViewerState(viewer.getState(), {
      kind: "present-result",
      documentId: document.id,
      modelIdentity: presentationJobId,
      quality: command.quality,
      result,
    }), true);
    if (documents.getState().activeDocumentId === document.id) {
      updateLayout({ kind: "render-succeeded", jobId: presentationJobId });
    }
    if (cacheKey && renderCache) {
      try {
        await renderCache.put(projectState.snapshot.workspaceIdentity, cacheKey, result);
        if (renderCache.touch?.(projectState.snapshot.workspaceIdentity, cacheKey)) {
          presentedCacheKeys.set(result, cacheKey);
        }
        if (engineInfo) {
          knownCacheKeys.set(
            renderMemoKey(
              workspace,
              projectRevision,
              projectState.snapshot.workspaceIdentity,
              document.id,
              request,
              engineInfo,
              rendering.profile.engine.executablePath,
            ),
            cacheKey,
          );
        }
      } catch {
        // Cache failure must not hide or downgrade a successful engine result.
      }
    }
    if (render.getState().jobId !== job.jobId) return;
    publishCompletedRender();
    if (!snapshotIsCurrent() || renderAttempt !== renderAttemptGeneration) return;
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
    historyDetails: readonlyStore(historyDetails),
    modelHistory: readonlyStore(modelHistory),
    modelHistoryPersistence: readonlyStore(modelHistoryPersistence),
    controls: readonlyStore(controls),
    renderThumbnails,
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
