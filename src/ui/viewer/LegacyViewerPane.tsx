import { lazy, Suspense } from "react";

import type {
  Quality,
  RenderResult,
  RenderSuccess3D,
} from "../../application/engine/contracts";
import type { WorkspaceLayoutAction } from "../../application/layout/workspace-layout";
import type { ThemeTokens } from "../../application/theme/theme-schema";
import { messages } from "../../messages/en";

const ModelViewer = lazy(() =>
  import("./ModelViewer").then((module) => ({ default: module.ModelViewer }))
);

export interface LegacyViewerPaneProps {
  activeResult?: RenderResult;
  colors: ThemeTokens["viewer"];
  maximized: boolean;
  narrow: boolean;
  quality?: Quality;
  renderStatus: "idle" | "rendering" | "success" | "failure";
  result?: RenderSuccess3D;
  onLayoutAction(action: WorkspaceLayoutAction): void;
}

function boundsLabel(result?: RenderSuccess3D): string | null {
  const bounds = result?.stats.boundingBox;
  if (!bounds) return null;
  const size = bounds.max.map((maximum, axis) => maximum - bounds.min[axis]);
  return `${size.map((value) => Number(value.toFixed(3))).join(" × ")} mm`;
}

export function LegacyViewerPane({
  activeResult,
  colors,
  maximized,
  narrow,
  quality,
  renderStatus,
  result,
  onLayoutAction,
}: LegacyViewerPaneProps) {
  const measuredBounds = boundsLabel(result);
  return (
    <section className="viewer-panel" aria-label={messages.viewerRegion}>
      <div className="panel-heading viewer-heading">
        <span>{messages.viewerRegion}</span>
        <div className="viewer-heading-actions">
          {activeResult && quality === "preview" && renderStatus === "success" && (
            <span className="quality-badge">{messages.previewQuality}</span>
          )}
          {!narrow && (
            <button
              aria-label={messages.collapseViewer}
              className="panel-action"
              onClick={() => onLayoutAction({ kind: "toggle-panel", panel: "viewer" })}
              type="button"
            >
              <span aria-hidden="true">−</span>
            </button>
          )}
          {!narrow && (
            <button
              aria-label={maximized ? messages.restoreViewer : messages.maximizeViewer}
              className="panel-action"
              onClick={() => onLayoutAction({ kind: "toggle-maximize", region: "viewer" })}
              type="button"
            >
              <span aria-hidden="true">{maximized ? "↙" : "↗"}</span>
            </button>
          )}
        </div>
      </div>
      <Suspense fallback={
        <div className="surface-loading" role="status">{messages.loadingViewer}</div>
      }>
        <ModelViewer result={result} colors={colors} />
      </Suspense>
      {measuredBounds && <output className="bounds-readout">{measuredBounds}</output>}
      {activeResult?.kind === "failure" && (
        <div className="render-error" role="alert">{activeResult.rawLog}</div>
      )}
    </section>
  );
}
