import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

import type {
  ActivityPanel,
  ResizablePanel,
  WorkspaceLayoutAction,
  WorkspaceLayoutState,
} from "../../application/layout/workspace-layout";
import { messages } from "../../messages/en";
import { PanelSplitter } from "./PanelSplitter";

export interface WorkspaceFrameProps {
  activityBadges?: Readonly<Partial<Record<ActivityPanel, boolean>>>;
  activityContent?: Readonly<Partial<Record<ActivityPanel, ReactNode>>>;
  consoleContent?: ReactNode;
  parameterContent?: ReactNode;
  layout: WorkspaceLayoutState;
  narrow: boolean;
  editor: ReactNode;
  viewer: ReactNode;
  onLayoutAction(action: WorkspaceLayoutAction): void;
}

const ACTIVITY_COPY: Readonly<Record<ActivityPanel, { label: string; empty: string }>> = {
  files: { label: messages.activityFiles, empty: messages.noFolderOpen },
  search: { label: messages.activitySearch, empty: messages.projectSearchUnavailable },
  history: { label: messages.activityHistory, empty: messages.noHistoryYet },
  ai: { label: messages.activityAi, empty: messages.aiNotConfigured },
  libraries: { label: messages.activityLibraries, empty: messages.noLibrariesInstalled },
};

export function WorkspaceFrame({
  activityBadges = {},
  activityContent = {},
  consoleContent,
  parameterContent,
  layout,
  narrow,
  editor,
  viewer,
  onLayoutAction,
}: WorkspaceFrameProps) {
  const [viewportWidth, setViewportWidth] = useState(() => globalThis.innerWidth || 1200);
  const [previewSizes, setPreviewSizes] = useState<Partial<Record<ResizablePanel, number>>>({});
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(globalThis.innerWidth || 1200);
    globalThis.addEventListener?.("resize", updateViewportWidth);
    return () => globalThis.removeEventListener?.("resize", updateViewportWidth);
  }, []);
  const authoritativeLayoutKey = [
    layout.consoleHeight,
    layout.consoleOpen,
    layout.dockOpen,
    layout.dockWidth,
    layout.editorOpen,
    layout.maximized,
    layout.parameterHeight,
    layout.parameterOpen,
    layout.viewerOpen,
    layout.viewerWidth,
    narrow,
  ].join(":");
  useEffect(() => {
    if (authoritativeLayoutKey.length === 0) return;
    setPreviewSizes((current) => Object.keys(current).length === 0 ? current : {});
  }, [authoritativeLayoutKey]);
  const activeCopy = ACTIVITY_COPY[layout.activeRail];
  const dockMaximum = Math.max(180, Math.min(480, Math.floor(viewportWidth * 0.28)));
  const viewerMaximum = Math.max(320, Math.min(720, Math.floor(viewportWidth * 0.44)));
  const authoritativeDockWidth = Math.min(layout.dockWidth, dockMaximum);
  const authoritativeViewerWidth = Math.min(layout.viewerWidth, viewerMaximum);
  const dockWidth = previewSizes.dock ?? authoritativeDockWidth;
  const viewerWidth = previewSizes.viewer ?? authoritativeViewerWidth;
  const parameterHeight = previewSizes.parameter ?? layout.parameterHeight;
  const consoleHeight = previewSizes.console ?? layout.consoleHeight;
  const editorHidden = narrow
    ? layout.narrowView !== "code"
    : !layout.editorOpen || layout.maximized === "viewer";
  const viewerHidden = narrow
    ? layout.narrowView !== "model"
    : !layout.viewerOpen || layout.maximized === "editor";
  const dockHidden = narrow
    ? !layout.narrowDockOpen
    : !layout.dockOpen || layout.maximized !== null;
  const parameterHidden = narrow
    ? layout.narrowSheet !== "parameter"
    : !layout.parameterOpen || viewerHidden || layout.maximized === "viewer";
  const consoleHidden = narrow
    ? layout.narrowSheet !== "console"
    : !layout.consoleOpen || layout.maximized !== null;
  const frameStyle: CSSProperties | undefined = narrow
    ? undefined
    : {
        gridTemplateRows: consoleHidden
          ? "minmax(0, 1fr) 0 0"
          : `minmax(0, 1fr) 4px ${consoleHeight}px`,
      };
  const editorTrack = editorHidden ? "0" : "minmax(0, 1fr)";
  const viewerTrack = viewerHidden
    ? "0"
    : editorHidden
      ? "minmax(0, 1fr)"
      : `min(${viewerWidth}px, 44vw)`;
  const primaryStyle: CSSProperties | undefined = narrow
    ? undefined
    : {
        gridTemplateColumns: [
          "44px",
          dockHidden ? "0" : `min(${dockWidth}px, 28vw)`,
          dockHidden ? "0" : "4px",
          editorTrack,
          editorHidden || viewerHidden ? "0" : "4px",
          viewerTrack,
        ].join(" "),
      };
  const viewerColumnStyle: CSSProperties | undefined = narrow
    ? undefined
    : {
        gridTemplateRows: parameterHidden
          ? "minmax(0, 1fr) 0 0"
          : `minmax(0, 1fr) 4px ${parameterHeight}px`,
      };
  const commitResize = (
    panel: "dock" | "viewer" | "parameter" | "console",
    size: number,
  ) => onLayoutAction({ kind: "resize-panel", panel, size });
  const previewResize = (panel: ResizablePanel, size: number | null) => {
    setPreviewSizes((current) => {
      if (size !== null) return { ...current, [panel]: size };
      const next = { ...current };
      delete next[panel];
      return next;
    });
  };
  const toggleSheetPanel = (panel: "parameter" | "console") => {
    if (!narrow) {
      onLayoutAction({ kind: "toggle-panel", panel });
      return;
    }
    onLayoutAction({
      kind: "set-narrow-sheet",
      sheet: layout.narrowSheet === panel ? null : panel,
    });
  };

  return (
    <div
      className="workspace-frame"
      data-layout-mode={narrow ? "narrow" : "wide"}
      style={frameStyle}
    >
      <fieldset aria-label={messages.workspaceView} className="narrow-view-switcher">
        <button
          aria-pressed={layout.narrowView === "code"}
          onClick={() => onLayoutAction({ kind: "set-narrow-view", view: "code" })}
          type="button"
        >
          {messages.codeView}
        </button>
        <button
          aria-pressed={layout.narrowView === "model"}
          onClick={() => onLayoutAction({ kind: "set-narrow-view", view: "model" })}
          type="button"
        >
          {messages.modelView}
        </button>
      </fieldset>

      <div className="workspace-primary" style={primaryStyle}>
        <nav aria-label={messages.activityRail} className="activity-rail">
          {(Object.keys(ACTIVITY_COPY) as ActivityPanel[]).map((panel) => {
            const copy = ACTIVITY_COPY[panel];
            const active = layout.activeRail === panel && !dockHidden;
            return (
              <button
                aria-label={activityBadges[panel] ? messages.activityWithBadge(copy.label) : copy.label}
                aria-pressed={active}
                key={panel}
                onClick={() => onLayoutAction({ kind: "activate-rail", panel, narrow })}
                title={copy.label}
                type="button"
              >
                <span aria-hidden="true">{copy.label.slice(0, 1)}</span>
                {activityBadges[panel] && <span aria-hidden="true" className="activity-badge" />}
              </button>
            );
          })}
          <span aria-hidden="true" className="activity-rail-spacer" />
          <button
            aria-label={messages.toggleParameters}
            aria-pressed={!parameterHidden}
            onClick={() => toggleSheetPanel("parameter")}
            title={messages.toggleParameters}
            type="button"
          >
            <span aria-hidden="true">P</span>
          </button>
          <button
            aria-label={messages.toggleConsole}
            aria-pressed={!consoleHidden}
            onClick={() => toggleSheetPanel("console")}
            title={messages.toggleConsole}
            type="button"
          >
            <span aria-hidden="true">C</span>
          </button>
          <button
            aria-label={messages.resetLayout}
            className="reset-layout-button"
            onClick={() => onLayoutAction({ kind: "reset-layout" })}
            title={messages.resetLayout}
            type="button"
          >
            <span aria-hidden="true">↺</span>
          </button>
        </nav>

        <section
          aria-label={messages.panelRegion(activeCopy.label)}
          className="workspace-dock"
          hidden={dockHidden}
          style={narrow ? { width: layout.dockWidth } : undefined}
          tabIndex={-1}
        >
          <header className="layout-panel-heading">
            <span>{activeCopy.label}</span>
            <button
              aria-label={messages.closePanel(activeCopy.label)}
              onClick={() =>
                onLayoutAction({ kind: "activate-rail", panel: layout.activeRail, narrow })
              }
              type="button"
            >
              ×
            </button>
          </header>
          {activityContent[layout.activeRail] ?? <p>{activeCopy.empty}</p>}
        </section>

        {!narrow && !dockHidden && (
          <PanelSplitter
            label={messages.resizeFilesPanel}
            orientation="vertical"
            value={authoritativeDockWidth}
            minimum={180}
            maximum={dockMaximum}
            growthDirection={1}
            onCommit={(size) => commitResize("dock", size)}
            onPreview={(size) => previewResize("dock", size)}
          />
        )}

        <div className="workspace-editor" hidden={editorHidden}>{editor}</div>

        {!narrow && !editorHidden && !viewerHidden && (
          <PanelSplitter
            label={messages.resizeViewerColumn}
            orientation="vertical"
            value={authoritativeViewerWidth}
            minimum={320}
            maximum={viewerMaximum}
            growthDirection={-1}
            onCommit={(size) => commitResize("viewer", size)}
            onPreview={(size) => previewResize("viewer", size)}
          />
        )}

        <div
          className="workspace-viewer workspace-viewer-column"
          hidden={viewerHidden}
          style={viewerColumnStyle}
        >
          <div className="workspace-viewer-surface">{viewer}</div>
          {!narrow && !parameterHidden && (
            <PanelSplitter
              label={messages.resizeParameters}
              orientation="horizontal"
              value={layout.parameterHeight}
              minimum={120}
              maximum={480}
              growthDirection={-1}
              onCommit={(size) => commitResize("parameter", size)}
              onPreview={(size) => previewResize("parameter", size)}
            />
          )}
          <section
            aria-label={messages.parametersRegion}
            className="workspace-parameter-panel"
            hidden={parameterHidden}
            style={narrow ? { height: layout.parameterHeight } : undefined}
            tabIndex={-1}
          >
            <header className="layout-panel-heading">
              <span>{messages.parametersRegion}</span>
              <button
                aria-label={messages.collapseParameters}
                onClick={() => toggleSheetPanel("parameter")}
                type="button"
              >
                ×
              </button>
            </header>
            {parameterContent ?? <p>{messages.noParametersDetected}</p>}
          </section>
        </div>
      </div>

      {!narrow && !consoleHidden && (
        <PanelSplitter
          label={messages.resizeConsole}
          orientation="horizontal"
          value={layout.consoleHeight}
          minimum={100}
          maximum={400}
          growthDirection={-1}
          onCommit={(size) => commitResize("console", size)}
          onPreview={(size) => previewResize("console", size)}
        />
      )}
      <section
        aria-label={messages.consoleRegion}
        className="workspace-console"
        hidden={consoleHidden}
        style={narrow ? { height: layout.consoleHeight } : undefined}
        tabIndex={-1}
      >
        <header className="layout-panel-heading">
          <span>{messages.consoleRegion}</span>
          <button
            aria-label={messages.collapseConsole}
            onClick={() => toggleSheetPanel("console")}
            type="button"
          >
            ×
          </button>
        </header>
        {consoleContent ?? <p>{messages.noDiagnosticsYet}</p>}
      </section>
    </div>
  );
}
