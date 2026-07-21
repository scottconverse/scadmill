import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { activeDocument, canCloseDocument, canReopenDocument } from "../application/documents/document-workspace";
import { createProjectSnapshot } from "../application/files/project-snapshot";
import type { WorkspaceLayoutAction } from "../application/layout/workspace-layout";
import { startSlicerHandoff } from "../application/manufacturing/slicer-handoff";
import { parameterDocument } from "../application/parameters/parameter-state";
import { buildRuntimeRenderFileMap } from "../application/runtime/project-render-files";
import { EPHEMERAL_SECRET_STORE } from "../application/settings/secret-store";
import { viewerDocument } from "../application/viewer/viewer-state";
import { messages } from "../messages/en";
import { AiWorkbenchPanel } from "./ai";
import { DiagnosticConsole } from "./diagnostics/DiagnosticConsole";
import { useDiagnosticNavigation } from "./diagnostics/use-diagnostic-navigation";
import type { CodeEditorSession, CursorPosition } from "./editor/CodeEditor";
import { EditorGroupsPane } from "./editor/EditorGroupsPane";
import { useDocumentKeybindings } from "./editor/use-document-keybindings";
import { useEditorCommandCoordinator } from "./editor/use-editor-command-coordinator";
import { useProjectCompletionContext } from "./editor/use-project-completion-context";
import { useProjectNavigation } from "./editor/use-project-navigation";
import { FilesActivity } from "./files/FilesActivity";
import { ProjectSessionHost } from "./files/ProjectSessionHost";
import { useFileCommands } from "./files/use-file-commands";
import { useProjectOpenQueue } from "./files/use-project-open-queue";
import { useLayoutKeybindings, useNarrowLayout, useNativeMenuState, usePlatformMenuCommands, WebMenuBar, WorkbenchStatusBar, WorkspaceFrame } from "./layout";
import { LibrariesActivity } from "./libraries/LibrariesActivity";
import { ManufacturingActivity } from "./manufacturing/ManufacturingActivity";
import { HistoryActivityConnector, useMcpReviewApproval, useMcpStdio, useMcpViewportCapture } from "./mcp";
import { ParameterPanelConnector } from "./parameters/ParameterPanelConnector";
import { activePresentationToken, presentationHiddenByMode, RenderControls, RenderStatusText, sameRenderStateExceptCached, useWorkbenchRenderCommands } from "./render";
import { SettingsLauncher } from "./settings/SettingsLauncher";
import { SearchActivity } from "./search/SearchActivity";
import { useReadonlyStore } from "./use-readonly-store";
import { resolveActiveViewerPresentation } from "./viewer/active-viewer-presentation";
import { usePresentationReadiness } from "./viewer/use-presentation-readiness";
import { pngDataUrl } from "./viewer/png-data-url";
import { ViewerPaneConnector } from "./viewer/ViewerPaneConnector";
import { WorkbenchBanners } from "./WorkbenchBanners";
import { DismissibleNotice, NativeHelpPanel } from "./WorkbenchOverlays";
import { WelcomeLauncher } from "./welcome/WelcomeLauncher";
import type { WorkbenchProps } from "./workbench-props";
import { diagnosticStatusLabel, geometryDeltaStatus } from "./workbench-status";
import "./workbench.css"; const CodeEditor = lazy(() => import("./editor/CodeEditor").then((module) => ({ default: module.CodeEditor })));
export function Workbench({
  runtime, aiFetch = () => globalThis.fetch.bind(globalThis), engine, secretStore = EPHEMERAL_SECRET_STORE,
  engineLabel, engineAvailable = true, engineChecking = false, engineRecovery,
  wasmEngineProgress, wasmEngineFailureMessage,
  activeTheme,
  customThemes = [],
  themePreference,
  showWebMenu = true, menuCommandSource, associatedFileOpenSource, forceNarrowLayout = false,
  canRevealProjectFiles, canTrashProjectFiles, clipboard,
  projectStorage, directoryPicker, workspaceDirectory,
  recoveryPersistence,
  projectPortability,
  scratchAutosavePersistence,
  slicerHandoff,
  onThemePreferenceChange,
  configuredEnginePath = "", onConfigureEnginePath, onRetryWasmEngine, renderDiskCacheAvailable = false,
  mcpPort,
}: WorkbenchProps) {
  const documents = useReadonlyStore(runtime.documents, (state) => state);
  const document = activeDocument(documents); const render = useReadonlyStore(runtime.render, (state) => state, sameRenderStateExceptCached);
  const consoleState = useReadonlyStore(runtime.console, (state) => state);
  const { autoRender, editor: editorSettings, keybindings, persistenceStatus: settingsPersistenceStatus, profile } = useReadonlyStore(runtime.settings, (state) => state);
  const formatterSettings = profile.formatter;
  const layout = useReadonlyStore(runtime.layout, (state) => state);
  const viewerState = useReadonlyStore(runtime.viewer, (state) => state);
  const parameterState = useReadonlyStore(runtime.parameters, (state) => state);
  const currentParameters = parameterDocument(parameterState, document.id);
  const [viewerScreenshotDataUrl, setViewerScreenshotDataUrl] = useState<string>(); const { capture: captureMcpScreenshot, setCapture: setMcpScreenshotCapture } = useMcpViewportCapture();
  const { connected: mcpConnected, enabled: mcpEnabled, setEnabled: setMcpEnabled, permissions: mcpPermissions, setPermission: setMcpPermission, pendingReviews, pendingReview, approveReview, restoreReview, dismissReview, agentHandler } = useMcpStdio(runtime, engine, mcpPort, captureMcpScreenshot);
  useEffect(() => { if (document.id) setViewerScreenshotDataUrl(undefined); }, [document.id]);
  const projectState = useReadonlyStore(runtime.project, (state) => state);
  const animationFiles = buildRuntimeRenderFileMap(projectState, documents);
  const controls = useReadonlyStore(runtime.controls, (state) => state);
  const { sourceForPath: sourceForMcpPath, approve: approveMcpReview } = useMcpReviewApproval(
    runtime, documents, projectState, approveReview, restoreReview,
  );
  const editorProjectCompletion = useProjectCompletionContext(projectState, documents);
  const narrow = useNarrowLayout(undefined, forceNarrowLayout);
  const activeViewer = viewerDocument(viewerState, document.id);
  const presentation = resolveActiveViewerPresentation({
    activeDocumentId: document.id, documents,
    parameters: parameterState, render,
    viewer: activeViewer,
  });
  const presentationToken = activePresentationToken(render, document.id, presentation.stale);
  const presentationReadiness = usePresentationReadiness(presentationToken, Boolean(presentationToken && presentationHiddenByMode(render.result, activeViewer.mode)));
  const presentationStatus = render.status === "success" && (render.result?.kind === "2d" || render.result?.kind === "3d") && !presentationToken ? "withheld" : presentationReadiness.presentationStatus;
  const aiDiagnostics = (presentation.currentResult?.diagnostics ?? []).map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`);
  const aiParameters = currentParameters.parameters.map((parameter) => `${parameter.name} = ${String(parameter.defaultValue)}`);
  const diagnosticNavigation = useDiagnosticNavigation({ diagnostics: presentation.currentResult?.diagnostics,
    entryFile: render.entryFile, runtime, workspace: documents });
  const projectNavigation = useProjectNavigation({
    runtime, project: projectState, workspace: documents, activePath: document.path,
    activeSource: document.source, storage: projectStorage });
  const workbenchRoot = useRef<HTMLElement>(null);
  const editorSessions = useRef(new Map<string, CodeEditorSession>());
  const statusConsoleButton = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const { dismissError: dismissAssociatedFileOpenError, enqueue: enqueueProject,
    error: associatedFileOpenError, request: requestedProject, settle: settleProjectRequest } = useProjectOpenQueue(associatedFileOpenSource);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [nativeHelpVisible, setNativeHelpVisible] = useState(false);
  const diagnosticStatus = diagnosticStatusLabel(presentation.failure ?? presentation.result, document.path);
  const geometryStatus = geometryDeltaStatus(presentation.geometryDelta);
  const consoleVisible = narrow
    ? layout.narrowSheet === "console"
    : layout.consoleOpen && layout.maximized === null;
  const consoleContent = (
    <DiagnosticConsole
      canNavigate={diagnosticNavigation.canNavigate}
      clipboard={clipboard}
      emptyMessage={messages.noCurrentDiagnostics(document.path)}
      navigableJobId={presentation.currentResult ? render.jobId : undefined}
      onClear={() => void runtime.dispatch({ kind: "clear-console", origin: "user" })}
      onNavigate={diagnosticNavigation.navigate}
      state={consoleState}
    />
  );
  const dispatchLayout = useCallback(
    (action: WorkspaceLayoutAction) => {
      const focusedElement = globalThis.document?.activeElement;
      void runtime
        .dispatch({ kind: "update-layout", origin: "user", action })
        .then(() => {
          globalThis.setTimeout(() => {
            if (focusedElement?.closest("[hidden]")) {
              statusConsoleButton.current?.focus();
            }
          }, 0);
        });
    },
    [runtime],
  );
  const editorCommands = useEditorCommandCoordinator(runtime, layout, narrow, dispatchLayout);
  const { renderPreview, renderFull } = useWorkbenchRenderCommands(runtime, engineAvailable,
    render.status, keybindings);
  const openInSlicer = useCallback((configuredExecutablePath?: string) => {
    if (!engine || !slicerHandoff) return Promise.reject(new Error("Slicer handoff is unavailable."));
    const snapshot = createProjectSnapshot(
      projectState.snapshot.projectId,
      animationFiles,
      projectState.snapshot.workspaceIdentity,
    );
    return startSlicerHandoff({
      engine,
      handoff: slicerHandoff,
      snapshot,
      entryFile: document.path,
      parameters: currentParameters.overrides,
      timeoutMs: profile.rendering.fullTimeoutMs,
      configuredExecutablePath,
    }).done;
  }, [animationFiles, currentParameters.overrides, document.path, engine, profile.rendering.fullTimeoutMs, projectState.snapshot.projectId, projectState.snapshot.workspaceIdentity, slicerHandoff]);
  const fileCommands = useFileCommands({
    runtime, workspace: documents, layout, projectMode: projectState.mode,
    scratchPersistence: scratchAutosavePersistence,
    narrow, onLayoutAction: dispatchLayout, directoryPicker,
    formatter: formatterSettings, onProjectSelected: enqueueProject });
  const nativeMenuState = useNativeMenuState({ activeDocumentId: document.id, documents, engineAvailable, keybindings, layout, narrow, rendering: render.status === "rendering", saveAllDisabled: fileCommands.saveAllDisabled, saveDisabled: fileCommands.saveDisabled });
  const focusConsole = useCallback(() => {
    if (!consoleVisible) {
      dispatchLayout(narrow
        ? { kind: "set-narrow-sheet", sheet: "console" }
        : { kind: "toggle-panel", panel: "console" });
    }
    globalThis.setTimeout(() => {
      workbenchRoot.current?.querySelector<HTMLElement>(".workspace-console")?.focus();
    }, 0);
  }, [consoleVisible, dispatchLayout, narrow]);
  const activateDocument = useCallback((documentId: string) => {
    const restoreTabFocus = Boolean(
      globalThis.document?.activeElement?.closest(".code-editor"),
    );
    void runtime
      .dispatch({ kind: "activate-document", origin: "user", documentId })
      .then(() => {
        if (!restoreTabFocus) return;
        globalThis.setTimeout(() => {
          const tab = [...(workbenchRoot.current?.querySelectorAll<HTMLButtonElement>(
            "[role='tab'][data-document-id]",
          ) ?? [])].find((candidate) => candidate.dataset.documentId === documentId);
          tab?.focus();
        }, 0);
      });
  }, [runtime]);
  const closeDocument = useCallback((documentId: string) => {
    void runtime.dispatch({ kind: "close-document", origin: "user", documentId });
  }, [runtime]);
  const moveDocument = useCallback((documentId: string, toIndex: number) => {
    void runtime.dispatch({ kind: "move-document", origin: "user", documentId, toIndex });
  }, [runtime]);
  const reopenDocument = useCallback(() => {
    void runtime.dispatch({ kind: "reopen-document", origin: "user" });
  }, [runtime]);
  useLayoutKeybindings({
    activeRail: layout.activeRail,
    dispatch: dispatchLayout,
    narrow,
    narrowDockOpen: layout.narrowDockOpen,
    narrowSheet: layout.narrowSheet,
    narrowView: layout.narrowView,
    keybindings,
  });
  useDocumentKeybindings({
    workspace: documents, keybindings,
    onActivate: activateDocument, onClose: closeDocument, onReopen: reopenDocument,
    onSave: fileCommands.save, onSaveAll: fileCommands.saveAll,
    onNewFile: fileCommands.newFile, onOpenProject: fileCommands.openProject,
    onExport: fileCommands.exportModel,
  });
  usePlatformMenuCommands(menuCommandSource, layout, narrow, {
    closeDocument: () => closeDocument(document.id),
    editorCommand: editorCommands.requestCommand,
    exportModel: fileCommands.exportModel,
    layoutAction: dispatchLayout,
    newFile: fileCommands.newFile,
    openProject: fileCommands.openProject,
    renderFull,
    renderPreview,
    reopenDocument,
    save: fileCommands.save,
    saveAll: fileCommands.saveAll,
    showHelp: () => setNativeHelpVisible((visible) => !visible),
  }, nativeMenuState);
  const editor = (
    <EditorGroupsPane workspace={documents} maximized={layout.maximized === "editor"} narrow={narrow}
      onActivate={activateDocument} onClose={closeDocument} onMoveDocument={moveDocument}
      onTogglePanel={() => dispatchLayout({ kind: "toggle-panel", panel: "editor" })}
      onToggleMaximize={() => dispatchLayout({ kind: "toggle-maximize", region: "editor" })}
      renderEditor={(groupDocument, groupId, focused) => {
        const sessionKey = `${groupId}:${groupDocument.id}`;
        const cachedSession = editorSessions.current.get(sessionKey);
        const initialSession = cachedSession?.state.doc.toString() === groupDocument.source ? cachedSession : undefined;
        return <><Suspense fallback={<div className="surface-loading" role="status">{messages.loadingEditor}</div>}>
          <CodeEditor commandRequest={focused ? editorCommands.request : undefined}
            diagnostics={focused ? diagnosticNavigation.editorDiagnostics : []} editorSettings={editorSettings}
            formatterSettings={formatterSettings} keybindings={keybindings}
            language={projectState.mode === "scratch" || groupDocument.path.toLowerCase().endsWith(".scad") ? "openscad" : "plain"}
            initialSession={initialSession} key={sessionKey} value={groupDocument.source} label={`${groupDocument.path} editor`}
            navigation={focused ? projectNavigation.navigation ?? diagnosticNavigation.navigation : undefined}
            projectCompletion={focused ? editorProjectCompletion : undefined}
            onCommand={focused ? editorCommands.handleOutcome : undefined}
            onCursorChange={focused ? setCursor : undefined}
            onGoToDefinition={focused ? projectNavigation.goToDefinition : undefined}
            onNavigationHandled={focused ? (requestId) => { projectNavigation.completeNavigation(requestId); diagnosticNavigation.completeNavigation(requestId); } : undefined}
            onSessionChange={(session) => editorSessions.current.set(sessionKey, session)}
            onChange={(source) => void runtime.dispatch({ kind: "edit-document", origin: "user", documentId: groupDocument.id, source })} />
        </Suspense>{focused && editorCommands.notice && <p className="editor-command-notice" key={editorCommands.notice.sequence} role="status">{editorCommands.notice.message}</p>}</>;
      }} />
  );
  const viewer = (
    <ViewerPaneConnector
      colors={activeTheme.viewer} dimmed={presentation.dimmed} documentId={document.id}
      entryFile={document.path} source={document.source} sourceFiles={animationFiles}
      engineAvailable={engineAvailable} engineChecking={engineChecking}
      failure={presentation.failure} maximized={layout.maximized === "viewer"}
      narrow={narrow} quality={presentation.quality}
      renderJobId={presentation.status === "rendering" ? render.jobId : undefined}
      renderStartedAtMonotonicMs={presentation.status === "rendering" ? render.startedAtMonotonicMs : undefined}
      renderStartedAtMs={presentation.status === "rendering" ? render.startedAtMs : undefined}
      renderStatus={presentation.status} result={presentation.result} runtime={runtime}
      viewer={activeViewer} onLayoutAction={dispatchLayout} onShowConsole={focusConsole} onPresentationFailed={presentationReadiness.onPresentationFailed} onPresentationReady={presentationReadiness.onPresentationReady} waitForPresentation={presentationReadiness.waitForPresentation}
      onScreenshotCaptured={(bytes) => setViewerScreenshotDataUrl(pngDataUrl(bytes))} onMcpScreenshotCaptureAvailable={setMcpScreenshotCapture}
    />
  );
  return (
    <main className={`workbench${showWebMenu ? " workbench-with-web-menu" : ""}`} ref={workbenchRoot}>
      {showWebMenu && (
        <WebMenuBar
          closeDocumentDisabled={!canCloseDocument(documents, document.id)} layout={layout}
          keybindings={keybindings} narrow={narrow}
          reopenDocumentDisabled={!canReopenDocument(documents)}
          renderDisabled={!engineAvailable || render.status === "rendering"}
          saveDocumentDisabled={fileCommands.saveDisabled} saveAllDocumentsDisabled={fileCommands.saveAllDisabled}
          saveDocumentUnavailableReason={fileCommands.saveUnavailableReason}
          saveAllDocumentsUnavailableReason={fileCommands.saveAllUnavailableReason}
          onCloseDocument={() => closeDocument(document.id)} onEditorCommand={editorCommands.requestCommand}
          onLayoutAction={dispatchLayout} onReopenDocument={reopenDocument}
          onSaveDocument={fileCommands.save} onSaveAllDocuments={fileCommands.saveAll}
          onNewFile={fileCommands.newFile} onOpenProject={fileCommands.openProject}
          onExport={fileCommands.exportModel}
          recentProjects={projectState.recentProjects}
          onOpenRecentProject={(projectId, displayName) => enqueueProject({ projectId, displayName })}
          onRenderFull={renderFull} onRenderPreview={renderPreview}
        />
      )}
      <header className="titlebar">
        <div>
          <span className="brand-mark" aria-hidden="true">S</span>
          <h1>{messages.appName}</h1>
        </div>
        <WelcomeLauncher documents={documents} project={projectState} runtime={runtime} showOnLaunch={controls.showWelcomeOnLaunch} onNewFile={fileCommands.newFile} onOpenProject={fileCommands.openProject} onOpenRecentProject={(projectId, displayName) => enqueueProject({ projectId, displayName })} onShowOnLaunchChange={(enabled) => runtime.dispatch({ kind: "set-welcome-on-launch", origin: "user", enabled })} />
        <SettingsLauncher engineLabel={engineLabel} runtime={runtime} secretStore={secretStore} renderDiskCacheAvailable={renderDiskCacheAvailable} mcpPort={mcpPort} mcpEnabled={mcpEnabled} onMcpEnabledChange={setMcpEnabled} mcpPermissions={mcpPermissions} onMcpPermissionChange={setMcpPermission} />
        <RenderControls
          autoRender={autoRender}
          autoRenderDisabled={settingsPersistenceStatus.status === "load-error"}
          renderDisabled={!engineAvailable || render.status === "rendering"}
          rendering={render.status === "rendering"}
          onAutoRenderChange={(enabled) =>
            void runtime
              .dispatch({ kind: "set-auto-render", origin: "user", enabled })
              .catch(() => undefined)}
          onRenderFull={renderFull}
          onRenderPreview={renderPreview}
        />
      </header>
      {!showWebMenu && nativeHelpVisible && (
        <NativeHelpPanel onClose={() => setNativeHelpVisible(false)} onOpenSettings={() => {
          setNativeHelpVisible(false); workbenchRoot.current?.querySelector<HTMLButtonElement>(".settings-launcher")?.click();
        }} />
      )}
      <WorkbenchBanners
        configuredEnginePath={configuredEnginePath} engineAvailable={engineAvailable}
        engineChecking={engineChecking} engineRecovery={engineRecovery}
        settingsLoadError={settingsPersistenceStatus.status === "load-error"}
        wasmEngineProgress={wasmEngineProgress} wasmEngineFailureMessage={wasmEngineFailureMessage}
        onConfigureEnginePath={settingsPersistenceStatus.status === "load-error"
          ? undefined
          : onConfigureEnginePath}
        onRetryWasmEngine={onRetryWasmEngine}
      >
        {associatedFileOpenError && <DismissibleNotice message={associatedFileOpenError} onDismiss={dismissAssociatedFileOpenError} />}
        {fileCommands.notice && (
          <p className="file-command-notice" role="alert">{fileCommands.notice}</p>
        )}
        <ProjectSessionHost
          portability={projectPortability} recoveryPersistence={recoveryPersistence}
          requestedProject={requestedProject} onRequestedProjectSettled={settleProjectRequest}
          onSaveAll={fileCommands.saveAll} saveAllDisabled={fileCommands.saveAllDisabled} saveAllUnavailableReason={fileCommands.saveAllUnavailableReason}
          runtime={runtime} scratchAutosavePersistence={scratchAutosavePersistence}
          storage={projectStorage} onRecoveryPendingChange={setRecoveryPending}
        />
      </WorkbenchBanners>
      <WorkspaceFrame aiConfigured={(profile.ai.provider !== "none" && Boolean(profile.ai.model.trim() || profile.ai.models.length)) || profile.ai.configurations.length > 0} activityContent={{
          ai: <AiWorkbenchPanel key={projectState.snapshot.workspaceIdentity} agentToolHandler={agentHandler} aiFetch={aiFetch} contextInputs={{ source: document.source, diagnostics: aiDiagnostics, parameters: aiParameters, screenshotDataUrl: viewerScreenshotDataUrl }} document={document} onApproveReview={approveMcpReview} onCopy={clipboard?.writeText} onInsertAtCursor={(code) => { const session = editorSessions.current.get(document.id); const head = session?.state.selection.main.head ?? document.source.length; const offset = Math.max(0, Math.min(document.source.length, head)); void runtime.dispatch({ kind: "edit-document", origin: "ai-panel", documentId: document.id, source: `${document.source.slice(0, offset)}${code}${document.source.slice(offset)}` }).catch(() => undefined); }} pendingReview={pendingReview} profile={profile} projectIdentity={projectState.snapshot.workspaceIdentity} runtime={runtime} secretStore={secretStore} />,
          files: <FilesActivity canReveal={canRevealProjectFiles} canTrash={canTrashProjectFiles} directoryPicker={directoryPicker} engine={engineAvailable ? engine : undefined} portability={projectPortability} recoveryPersistence={recoveryPersistence} projectTransitionsBlocked={recoveryPending} requestedExport={fileCommands.requestedExport} requestedNewFile={fileCommands.requestedNewFile} runtime={runtime} storage={projectStorage} workspaceDirectory={workspaceDirectory} />,
          history: <HistoryActivityConnector runtime={runtime} pendingReviews={pendingReviews} sourceForPath={sourceForMcpPath} onApprove={approveMcpReview} onDeny={dismissReview} />,
          libraries: <LibrariesActivity key={projectState.snapshot.workspaceIdentity} project={projectState} storage={projectStorage} onProjectFilesChanged={() => runtime.dispatch({ kind: "refresh-project", origin: "user" }).then(() => undefined)} />,
          manufacturing: <ManufacturingActivity key={activeViewer.presentation?.renderIdentity ?? "no-full-render"} onOpenInSlicer={engineAvailable && engine && slicerHandoff ? openInSlicer : undefined} quality={activeViewer.presentation?.quality} result={activeViewer.presentation?.result.kind === "3d" ? activeViewer.presentation.result : undefined} />,
          search: <SearchActivity activePath={document.path} outline={projectNavigation.outline} references={projectNavigation.references} loadSources={projectNavigation.loadSources} onApplyReplacements={projectNavigation.applyReplacements} onFindReferences={projectNavigation.findReferences} onNavigate={projectNavigation.navigate} />,
        }}
        activityBadges={{ history: pendingReviews.length > 0 }}
        layout={layout}
        narrow={narrow}
        consoleContent={consoleContent} editor={editor}
        parameterContent={<ParameterPanelConnector documentId={document.id} runtime={runtime}
          state={currentParameters} />}
        viewer={viewer}
        onLayoutAction={dispatchLayout}
      />
      <WorkbenchStatusBar
        customThemes={customThemes} cursor={cursor}
        diagnosticStatus={diagnosticStatus} engineLabel={engineLabel}
        geometryStatus={geometryStatus} renderStatus={<RenderStatusText documentPath={document.path} presentationStatus={presentationStatus} renderStore={runtime.render} stale={presentation.stale} />} mcpConnected={mcpConnected}
        consoleVisible={consoleVisible} consoleButtonRef={statusConsoleButton}
        themePreference={themePreference} onFocusConsole={focusConsole}
        themePreferenceDisabled={settingsPersistenceStatus.status === "load-error"}
        onThemePreferenceChange={onThemePreferenceChange}
      />
    </main>
  );
}
