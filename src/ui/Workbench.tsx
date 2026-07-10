import { lazy, Suspense, useCallback, useRef, useState } from "react";
import {
  activeDocument,
  canCloseDocument,
  canReopenDocument,
} from "../application/documents/document-workspace";
import type { Diagnostic, RenderSuccess3D } from "../application/engine/contracts";
import type { WorkspaceLayoutAction } from "../application/layout/workspace-layout";
import type { WorkbenchRuntime } from "../application/runtime/workbench-runtime";
import type { ThemePreference } from "../application/theme/theme-runtime";
import type { ThemeTokens } from "../application/theme/theme-schema";
import { messages } from "../messages/en";
import { WebMenuBar } from "./layout/WebMenuBar";
import { WorkspaceFrame } from "./layout/WorkspaceFrame";
import { useLayoutKeybindings } from "./layout/use-layout-keybindings";
import { useNarrowLayout } from "./layout/use-narrow-layout";
import { useReadonlyStore } from "./use-readonly-store";
import type { CodeEditorSession, CursorPosition } from "./editor/CodeEditor";
import { DocumentTabBar, documentTabId } from "./editor/DocumentTabBar";
import { useDocumentKeybindings } from "./editor/use-document-keybindings";
import "./workbench.css";

const CodeEditor = lazy(() => import("./editor/CodeEditor").then((module) => ({ default: module.CodeEditor })));
const ModelViewer = lazy(() => import("./viewer/ModelViewer").then((module) => ({ default: module.ModelViewer })));

export interface WorkbenchProps {
  runtime: WorkbenchRuntime;
  engineLabel: string;
  engineAvailable?: boolean;
  activeTheme: ThemeTokens;
  themePreference: ThemePreference;
  showWebMenu?: boolean;
  forceNarrowLayout?: boolean;
  onThemePreferenceChange(preference: ThemePreference): void;
}

function boundsLabel(result?: RenderSuccess3D): string | null {
  const bounds = result?.stats.boundingBox;
  if (!bounds) return null;
  const size = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]);
  return `${size.map((value) => Number(value.toFixed(3))).join(" \u00d7 ")} mm`;
}

function diagnosticRows(diagnostics: readonly Diagnostic[]) {
  const occurrences = new Map<string, number>();
  return diagnostics.map((diagnostic) => {
    const identity = [
      diagnostic.file ?? "",
      diagnostic.line ?? "",
      diagnostic.severity,
      diagnostic.message,
    ].join(":");
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return { diagnostic, key: `${identity}:${occurrence}` };
  });
}

export function Workbench({
  runtime,
  engineLabel,
  engineAvailable = true,
  activeTheme,
  themePreference,
  showWebMenu = true,
  forceNarrowLayout = false,
  onThemePreferenceChange,
}: WorkbenchProps) {
  const documents = useReadonlyStore(runtime.documents, (state) => state);
  const document = activeDocument(documents);
  const render = useReadonlyStore(runtime.render, (state) => state);
  const layout = useReadonlyStore(runtime.layout, (state) => state);
  const narrow = useNarrowLayout(undefined, forceNarrowLayout);
  const renderedDocument = documents.documents.find(({ id }) => id === render.documentId);
  const renderStale = Boolean(
    render.documentId
    && (
      !renderedDocument
      || renderedDocument.revision !== render.sourceRevision
      || !render.sourceFiles
      || render.sourceFiles.size !== documents.documents.length
      || documents.documents.some(({ path, source }) => render.sourceFiles?.get(path) !== source)
    ),
  );
  const activeRenderResult = render.documentId === document.id && !renderStale
    ? render.result
    : undefined;
  const result = activeRenderResult?.kind === "3d" ? activeRenderResult : undefined;
  const measuredBounds = boundsLabel(result);
  const workbenchRoot = useRef<HTMLElement>(null);
  const editorSessions = useRef(new Map<string, CodeEditorSession>());
  const statusConsoleButton = useRef<HTMLButtonElement>(null);
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
  const diagnostics = activeRenderResult?.diagnostics;
  const errorCount = diagnostics?.filter(({ severity }) => severity === "error").length ?? 0;
  const warningCount = diagnostics?.filter(({ severity }) => severity === "warning").length ?? 0;
  const diagnosticStatus = !activeRenderResult
    ? messages.noCurrentDiagnosticsStatus(document.path)
    : activeRenderResult.kind === "failure" && activeRenderResult.reason === "cancelled"
      ? messages.renderCancelledStatus
      : activeRenderResult.kind === "failure" && diagnostics?.length === 0
        ? messages.renderFailedDiagnosticsUnavailable
        : messages.diagnosticSummary(errorCount, warningCount);
  const renderStatus = render.status === "idle"
    ? messages.renderIdle
    : render.status === "rendering"
      ? messages.renderingDocument(render.entryFile ?? document.path)
      : render.status === "success"
        ? renderStale
          ? messages.renderedDocumentStale(
              render.entryFile ?? document.path,
              render.result?.kind ?? "geometry",
            )
          : messages.renderedDocument(
              render.entryFile ?? document.path,
              render.result?.kind ?? "geometry",
            )
        : renderStale
          ? messages.staleRenderFailedDocument(render.entryFile ?? document.path)
          : messages.renderFailedDocument(render.entryFile ?? document.path);
  const consoleVisible = narrow
    ? layout.narrowSheet === "console"
    : layout.consoleOpen && layout.maximized === null;
  const consoleContent = !activeRenderResult
    ? <p>{messages.noCurrentDiagnostics(document.path)}</p>
    : diagnostics && diagnostics.length > 0
      ? (
          <ul aria-label={messages.renderDiagnostics} className="console-diagnostics">
            {diagnosticRows(diagnostics).map(({ diagnostic, key }) => (
              <li key={key}>
                <span className="console-diagnostic-severity" data-severity={diagnostic.severity}>
                  {diagnostic.severity}
                </span>
                <span>{diagnostic.message}</span>
              </li>
            ))}
          </ul>
        )
      : <pre className="console-log">{activeRenderResult.rawLog || diagnosticStatus}</pre>;
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
  const renderPreview = useCallback(() => {
    void runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
  }, [runtime]);
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
  });
  useDocumentKeybindings({
    workspace: documents,
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
            initialSession={initialEditorSession}
            key={document.id}
            value={document.source}
            label={messages.editorRegion}
            onCursorChange={setCursor}
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
      </div>
    </section>
  );

  const viewer = (
    <section className="viewer-panel" aria-label={messages.viewerRegion}>
      <div className="panel-heading viewer-heading">
        <span>{messages.viewerRegion}</span>
        <div className="viewer-heading-actions">
          {activeRenderResult && render.quality === "preview" && render.status === "success" && (
            <span className="quality-badge">{messages.previewQuality}</span>
          )}
          {!narrow && <button
            aria-label={messages.collapseViewer}
            className="panel-action"
            onClick={() => dispatchLayout({ kind: "toggle-panel", panel: "viewer" })}
            type="button"
          >
            <span aria-hidden="true">−</span>
          </button>}
          {!narrow && <button
            aria-label={layout.maximized === "viewer" ? messages.restoreViewer : messages.maximizeViewer}
            className="panel-action"
            onClick={() => dispatchLayout({ kind: "toggle-maximize", region: "viewer" })}
            type="button"
          >
            <span aria-hidden="true">{layout.maximized === "viewer" ? "↙" : "↗"}</span>
          </button>}
        </div>
      </div>
      <Suspense fallback={<div className="surface-loading" role="status">{messages.loadingViewer}</div>}>
        <ModelViewer result={result} colors={activeTheme.viewer} />
      </Suspense>
      {measuredBounds && <output className="bounds-readout">{measuredBounds}</output>}
      {activeRenderResult?.kind === "failure" && (
        <div className="render-error" role="alert">{activeRenderResult.rawLog}</div>
      )}
    </section>
  );

  return (
    <main
      className={`workbench${showWebMenu ? " workbench-with-web-menu" : ""}`}
      ref={workbenchRoot}
    >
      {showWebMenu && (
        <WebMenuBar
          closeDocumentDisabled={!canCloseDocument(documents, document.id)}
          layout={layout}
          narrow={narrow}
          reopenDocumentDisabled={!canReopenDocument(documents)}
          renderDisabled={!engineAvailable || render.status === "rendering"}
          onCloseDocument={() => closeDocument(document.id)}
          onLayoutAction={dispatchLayout}
          onReopenDocument={reopenDocument}
          onRenderPreview={renderPreview}
        />
      )}
      <header className="titlebar">
        <div>
          <span className="brand-mark" aria-hidden="true">S</span>
          <h1>{messages.appName}</h1>
        </div>
        <div className="titlebar-actions">
          <button
            className="render-button"
            disabled={!engineAvailable || render.status === "rendering"}
            onClick={renderPreview}
            type="button"
          >
            {render.status === "rendering" ? messages.rendering : messages.renderPreview}
          </button>
        </div>
      </header>

      {!engineAvailable && <div className="engine-banner" role="status">{messages.engineUnavailable}</div>}

      <WorkspaceFrame
        layout={layout}
        narrow={narrow}
        consoleContent={consoleContent}
        editor={editor}
        viewer={viewer}
        onLayoutAction={dispatchLayout}
      />

      <footer className="statusbar">
        <span className="status-engine">{engineLabel}</span>
        <span className="status-render">{renderStatus}</span>
        <button
          aria-label={messages.toggleConsoleStatus(diagnosticStatus)}
          aria-pressed={consoleVisible}
          className="status-chip status-diagnostics"
          onClick={() =>
            dispatchLayout(
              narrow
                ? {
                    kind: "set-narrow-sheet",
                    sheet: layout.narrowSheet === "console" ? null : "console",
                  }
                : { kind: "toggle-panel", panel: "console" },
            )
          }
          ref={statusConsoleButton}
          type="button"
        >
          {diagnosticStatus}
        </button>
        <span className="status-cursor">{messages.cursorPosition(cursor.line, cursor.column)}</span>
        <span className="status-encoding">{messages.untitledStatus}</span>
        <label className="theme-picker">
          <span>{messages.themeLabel}</span>
          <select
            aria-label={messages.themeLabel}
            value={themePreference}
            onChange={(event) =>
              onThemePreferenceChange(event.currentTarget.value as ThemePreference)
            }
          >
            <option value="system">{messages.themeSystem}</option>
            <option value="light">{messages.themeLight}</option>
            <option value="dark">{messages.themeDark}</option>
            <option value="high-contrast">{messages.themeHighContrast}</option>
          </select>
        </label>
      </footer>
    </main>
  );
}
