import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { activeDocument, canCloseDocument, canReopenDocument } from "../application/documents/document-workspace";
import type { WorkspaceLayoutAction } from "../application/layout/workspace-layout";
import { parameterDocument } from "../application/parameters/parameter-state";
import { EPHEMERAL_SECRET_STORE } from "../application/settings/secret-store";
import { viewerDocument } from "../application/viewer/viewer-state";
import { messages } from "../messages/en";
import { DiagnosticConsole } from "./diagnostics/DiagnosticConsole";
import { useDiagnosticNavigation } from "./diagnostics/use-diagnostic-navigation";
import type { CodeEditorSession, CursorPosition } from "./editor/CodeEditor";
import { DocumentTabBar, documentTabId } from "./editor/DocumentTabBar";
import { useDocumentKeybindings } from "./editor/use-document-keybindings";
import { useEditorCommandCoordinator } from "./editor/use-editor-command-coordinator";
import { type EngineRecoveryState, EngineUnavailableBanner } from "./engine/EngineUnavailableBanner";
import { FilesActivity } from "./files/FilesActivity";
import type { ProjectOpenRequest } from "./files/ProjectLifecycleControls";
import { ProjectSessionHost } from "./files/ProjectSessionHost";
import { useFileCommands } from "./files/use-file-commands";
import { useLayoutKeybindings } from "./layout/use-layout-keybindings";
import { useNarrowLayout } from "./layout/use-narrow-layout";
import { WebMenuBar } from "./layout/WebMenuBar";
import { WorkbenchStatusBar } from "./layout/WorkbenchStatusBar";
import { WorkspaceFrame } from "./layout/WorkspaceFrame";
import { ParameterPanelConnector } from "./parameters/ParameterPanelConnector";
import { RenderControls } from "./render/RenderControls";
import { useWorkbenchRenderCommands } from "./render/use-workbench-render-commands";
import { SettingsLauncher } from "./settings/SettingsLauncher";
import { useReadonlyStore } from "./use-readonly-store";
import { resolveActiveViewerPresentation } from "./viewer/active-viewer-presentation";
import { ViewerPaneConnector } from "./viewer/ViewerPaneConnector";
import type { WorkbenchProps } from "./workbench-props";
import { diagnosticStatusLabel, renderStatusLabel } from "./workbench-status";
import "./workbench.css";

const CodeEditor = lazy(() => import("./editor/CodeEditor").then((module) => ({ default: module.CodeEditor })));
export function Workbench({
  runtime,
  engine,
  secretStore = EPHEMERAL_SECRET_STORE,
  engineLabel,
  engineAvailable = true,
  engineChecking = false,
  engineRecovery,
  activeTheme,
  customThemes = [],
  themePreference,
  showWebMenu = true,
  forceNarrowLayout = false,
  canRevealProjectFiles,
  projectStorage,
  recoveryPersistence,
  projectPortability,
  scratchAutosavePersistence,
  onThemePreferenceChange,
  configuredEnginePath = "",
  onConfigureEnginePath,
}: WorkbenchProps) {
  const documents = useReadonlyStore(runtime.documents, (state) => state);
  const document = activeDocument(documents);
  const render = useReadonlyStore(runtime.render, (state) => state);
  const consoleState = useReadonlyStore(runtime.console, (state) => state);
  const autoRender = useReadonlyStore(runtime.settings, (state) => state.autoRender);
  const editorSettings = useReadonlyStore(runtime.settings, (state) => state.editor);
  const keybindings = useReadonlyStore(runtime.settings, (state) => state.keybindings);
  const layout = useReadonlyStore(runtime.layout, (state) => state);
  const viewerState = useReadonlyStore(runtime.viewer, (state) => state);
  const parameterState = useReadonlyStore(runtime.parameters, (state) => state);
  const projectState = useReadonlyStore(runtime.project, (state) => state);
  const narrow = useNarrowLayout(undefined, forceNarrowLayout);
  const activeViewer = viewerDocument(viewerState, document.id);
  const presentation = resolveActiveViewerPresentation({
    activeDocumentId: document.id,
    documents,
    parameters: parameterState,
    render,
    viewer: activeViewer,
  });
  const currentRenderResult = presentation.currentResult;
  const activeRenderResult = presentation.failure ?? presentation.result;
  const diagnosticNavigation = useDiagnosticNavigation({
    diagnostics: currentRenderResult?.diagnostics,
    entryFile: render.entryFile,
    runtime,
    workspace: documents,
  });
  const effectiveEngineRecovery: EngineRecoveryState | undefined = engineRecovery
    ?? (!engineChecking ? { kind: "unavailable" } : undefined);
  const workbenchRoot = useRef<HTMLElement>(null);
  const editorSessions = useRef(new Map<string, CodeEditorSession>());
  const statusConsoleButton = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const [requestedProject, setRequestedProject] = useState<ProjectOpenRequest>();
  const [recoveryPending, setRecoveryPending] = useState(false);
  const diagnosticStatus = diagnosticStatusLabel(activeRenderResult, document.path);
  const renderStatus = renderStatusLabel(render, presentation.stale, document.path);
  const consoleVisible = narrow
    ? layout.narrowSheet === "console"
    : layout.consoleOpen && layout.maximized === null;
  const consoleContent = (
    <DiagnosticConsole
      canNavigate={diagnosticNavigation.canNavigate}
      emptyMessage={messages.noCurrentDiagnostics(document.path)}
      navigableJobId={currentRenderResult ? render.jobId : undefined}
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
  const { renderPreview, renderFull } = useWorkbenchRenderCommands(
    runtime,
    engineAvailable,
    render.status,
    keybindings,
  );
  const fileCommands = useFileCommands({
    runtime,
    workspace: documents,
    projectMode: projectState.mode,
    scratchPersistence: scratchAutosavePersistence,
    narrow,
    onLayoutAction: dispatchLayout,
  });
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
    workspace: documents,
    keybindings,
    onActivate: activateDocument,
    onClose: closeDocument,
    onReopen: reopenDocument,
  });
  const cachedEditorSession = editorSessions.current.get(document.id);
  const initialEditorSession = cachedEditorSession?.state.doc.toString() === document.source
    ? cachedEditorSession
    : undefined;

  const editor = (
    <section className="editor-panel" aria-label={messages.editorRegion}>
      <div className="panel-heading editor-tab-heading">
        <DocumentTabBar
          workspace={documents}
          onActivate={activateDocument}
          onClose={closeDocument}
          onMove={moveDocument}
        />
        {!narrow && <div className="panel-heading-actions">
          <button
            aria-label={messages.collapseEditor}
            className="panel-action"
            onClick={() => dispatchLayout({ kind: "toggle-panel", panel: "editor" })}
            type="button"
          >
            <span aria-hidden="true">−</span>
          </button>
          <button
            aria-label={layout.maximized === "editor" ? messages.restoreEditor : messages.maximizeEditor}
            className="panel-action"
            onClick={() => dispatchLayout({ kind: "toggle-maximize", region: "editor" })}
            type="button"
          >
            <span aria-hidden="true">{layout.maximized === "editor" ? "↙" : "↗"}</span>
          </button>
        </div>}
      </div>
      <div
        aria-labelledby={documentTabId(document.id)}
        className="editor-document-panel"
        id="active-document-editor"
        role="tabpanel"
      >
        <Suspense fallback={<div className="surface-loading" role="status">{messages.loadingEditor}</div>}>
          <CodeEditor
            commandRequest={editorCommands.request}
            diagnostics={diagnosticNavigation.editorDiagnostics}
            editorSettings={editorSettings}
            keybindings={keybindings}
            language={projectState.mode === "scratch" || document.path.toLowerCase().endsWith(".scad")
              ? "openscad"
              : "plain"}
            initialSession={initialEditorSession}
            key={document.id}
            value={document.source}
            label={messages.editorRegion}
            navigation={diagnosticNavigation.navigation}
            onCommand={editorCommands.handleOutcome}
            onCursorChange={setCursor}
            onNavigationHandled={diagnosticNavigation.completeNavigation}
            onSessionChange={(session) => editorSessions.current.set(document.id, session)}
            onChange={(source) =>
              void runtime.dispatch({
                kind: "edit-document",
                origin: "user",
                documentId: document.id,
                source,
              })
            }
          />
        </Suspense>
        {editorCommands.notice && (
          <p
            className="editor-command-notice"
            key={editorCommands.notice.sequence}
            role="status"
          >
            {editorCommands.notice.message}
          </p>
        )}
      </div>
    </section>
  );

  const viewer = (
    <ViewerPaneConnector
      colors={activeTheme.viewer}
      dimmed={presentation.dimmed}
      documentId={document.id}
      failure={presentation.failure}
      maximized={layout.maximized === "viewer"}
      narrow={narrow}
      quality={presentation.quality}
      renderStatus={presentation.status}
      result={presentation.result}
      runtime={runtime}
      viewer={activeViewer}
      onLayoutAction={dispatchLayout}
      onShowConsole={focusConsole}
    />
  );

  return (
    <main
      className={`workbench${showWebMenu ? " workbench-with-web-menu" : ""}`}
      ref={workbenchRoot}
    >
      <ProjectSessionHost
        portability={projectPortability}
        recoveryPersistence={recoveryPersistence}
        requestedProject={requestedProject}
        runtime={runtime}
        scratchAutosavePersistence={scratchAutosavePersistence}
        storage={projectStorage}
        onRecoveryPendingChange={setRecoveryPending}
      />
      {fileCommands.notice && (
        <p className="file-command-notice" role="alert">{fileCommands.notice}</p>
      )}
      {showWebMenu && (
        <WebMenuBar
          closeDocumentDisabled={!canCloseDocument(documents, document.id)}
          layout={layout}
          keybindings={keybindings}
          narrow={narrow}
          reopenDocumentDisabled={!canReopenDocument(documents)}
          renderDisabled={!engineAvailable || render.status === "rendering"}
          saveDocumentDisabled={fileCommands.saveDisabled}
          saveAllDocumentsDisabled={fileCommands.saveAllDisabled}
          saveDocumentUnavailableReason={fileCommands.saveUnavailableReason}
          saveAllDocumentsUnavailableReason={fileCommands.saveAllUnavailableReason}
          onCloseDocument={() => closeDocument(document.id)}
          onEditorCommand={editorCommands.requestCommand}
          onLayoutAction={dispatchLayout}
          onReopenDocument={reopenDocument}
          onSaveDocument={fileCommands.save}
          onSaveAllDocuments={fileCommands.saveAll}
          onNewFile={fileCommands.newFile}
          onOpenProject={fileCommands.openProject}
          onExport={fileCommands.exportModel}
          recentProjects={projectState.recentProjects}
          onOpenRecentProject={(projectId, displayName) => setRequestedProject((current) => ({
            sequence: (current?.sequence ?? 0) + 1,
            projectId,
            displayName,
          }))}
          onRenderFull={renderFull}
          onRenderPreview={renderPreview}
        />
      )}
      <header className="titlebar">
        <div>
          <span className="brand-mark" aria-hidden="true">S</span>
          <h1>{messages.appName}</h1>
        </div>
        <SettingsLauncher engineLabel={engineLabel} runtime={runtime} secretStore={secretStore} />
        <RenderControls
          autoRender={autoRender}
          renderDisabled={!engineAvailable || render.status === "rendering"}
          rendering={render.status === "rendering"}
          onAutoRenderChange={(enabled) =>
            void runtime.dispatch({ kind: "set-auto-render", origin: "user", enabled })}
          onRenderFull={renderFull}
          onRenderPreview={renderPreview}
        />
      </header>

      {!engineAvailable && onConfigureEnginePath && effectiveEngineRecovery && (
        <EngineUnavailableBanner
          configuredPath={configuredEnginePath}
          state={effectiveEngineRecovery}
          onSave={onConfigureEnginePath}
        />
      )}
      {!engineAvailable && !engineChecking && !onConfigureEnginePath && (
        <div className="engine-banner" role="status">{messages.engineUnavailable}</div>
      )}

      <WorkspaceFrame
        activityContent={{
          files: (
            <FilesActivity
              canReveal={canRevealProjectFiles}
              engine={engineAvailable ? engine : undefined}
              portability={projectPortability}
              recoveryPersistence={recoveryPersistence}
              projectTransitionsBlocked={recoveryPending}
              requestedExport={fileCommands.requestedExport}
              requestedNewFile={fileCommands.requestedNewFile}
              runtime={runtime}
              storage={projectStorage}
            />
          ),
        }}
        layout={layout}
        narrow={narrow}
        consoleContent={consoleContent}
        editor={editor}
        parameterContent={<ParameterPanelConnector documentId={document.id} runtime={runtime}
          state={parameterDocument(parameterState, document.id)} />}
        viewer={viewer}
        onLayoutAction={dispatchLayout}
      />

      <WorkbenchStatusBar
        customThemes={customThemes} cursor={cursor}
        diagnosticStatus={diagnosticStatus} engineLabel={engineLabel} renderStatus={renderStatus}
        consoleVisible={consoleVisible} consoleButtonRef={statusConsoleButton}
        themePreference={themePreference} onFocusConsole={focusConsole}
        onThemePreferenceChange={onThemePreferenceChange}
      />
    </main>
  );
}
