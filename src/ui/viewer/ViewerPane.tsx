import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { type KeybindingSettings, matchesKeybinding, primaryModifierForPlatform } from "../../application/commands/default-keybindings";
import type { Quality, RenderFailure, RenderResult } from "../../application/engine/contracts";
import type { WorkspaceLayoutAction } from "../../application/layout/workspace-layout";
import type { ThemeTokens } from "../../application/theme/theme-schema";
import type { WorkspaceAnnotationPersistenceState } from "../../application/viewer/annotation-persistence";
import type { CameraBookmark } from "../../application/viewer/camera-bookmarks";
import { cameraForAxis, cameraToFit, toggleProjection } from "../../application/viewer/camera";
import type { Bounds3, Point3 } from "../../application/viewer/measurements";
import type { ViewerAction, ViewerDocumentState, ViewerMode } from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";
import type { ModelViewerHandle } from "./ModelViewer";
import { RenderProgressOverlay } from "./RenderProgressOverlay";
import { useModelFrameReport } from "./use-model-frame-report";
import { useViewerThumbnail } from "./use-viewer-thumbnail";
import { useMcpScreenshotCapture } from "./use-mcp-screenshot-capture";
import { useViewerParts } from "./use-viewer-parts";
import { ViewerDetailsPanel } from "./ViewerDetailsPanel";
import { ViewerCameraBookmarks } from "./ViewerCameraBookmarks";
import { type ViewerTool, ViewerToolbar } from "./ViewerToolbar";
import { boundsLabel } from "./viewer-bounds-label";
import type { ViewerDegradation } from "./viewer-furniture";
import { EMPTY_VIEWER } from "./viewer-pane-defaults";
const ModelViewer = lazy(() => import("./ModelViewer").then((module) => ({ default: module.ModelViewer })));
const SvgViewer = lazy(() => import("./SvgViewer").then((module) => ({ default: module.SvgViewer })));
let fallbackId = 0;
function nextItemId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${++fallbackId}`;
}
export interface ViewerPaneProps {
  readonly colors: ThemeTokens["viewer"];
  readonly engineAvailable?: boolean;
  readonly engineChecking?: boolean;
  readonly maximized: boolean;
  readonly narrow: boolean;
  readonly quality?: Quality;
  readonly renderJobId?: string;
  readonly renderStartedAtMonotonicMs?: number;
  readonly renderStartedAtMs?: number;
  readonly renderStatus: "idle" | "rendering" | "success" | "failure";
  readonly settingsDisabled?: boolean;
  readonly result?: RenderResult;
  readonly failure?: RenderFailure;
  readonly dimmed?: boolean;
  readonly documentId?: string;
  readonly mode?: ViewerMode;
  readonly viewer?: ViewerDocumentState;
  readonly meshColor?: string | null;
  readonly keybindings?: KeybindingSettings;
  readonly mouseMapping?: {
    readonly orbit: "left" | "middle" | "right";
    readonly pan: "left" | "middle" | "right";
  };
  readonly onCancel?: () => void; readonly annotationPersistence?: WorkspaceAnnotationPersistenceState;
  readonly cameraBookmarks?: readonly CameraBookmark[]; readonly cameraBookmarkNotice?: string | null;
  readonly onSaveCameraBookmark?: (name: string, camera: ViewerDocumentState["camera"]) => void; readonly onDeleteCameraBookmark?: (bookmarkId: string) => void;
  readonly onRetryAnnotationPersistence?: () => void | Promise<void>;
  readonly onExportAnnotationMetadata?: () => void | Promise<void>;
  readonly onLayoutAction: (action: WorkspaceLayoutAction) => void;
  readonly onModeChange?: (mode: ViewerMode) => void;
  readonly onScreenshot?: (bytes: Uint8Array) => void | Promise<void>;
  readonly onMcpScreenshotCaptureAvailable?: (capture: ((width: number, height: number) => Promise<Uint8Array>) | undefined) => void;
  readonly thumbnailPersistenceDestination?: string;
  readonly onThumbnail?: (bytes: Uint8Array) => void | Promise<void>;
  readonly onPresentationFailed?: (token: string) => void;
  readonly onPresentationReady?: (identity: string) => void;
  readonly onShowConsole?: () => void;
  readonly onViewerAction?: (action: ViewerAction) => void;
}
export function ViewerPane({
  colors,
  engineAvailable = true,
  engineChecking = false,
  maximized,
  narrow,
  quality,
  renderJobId,
  renderStartedAtMonotonicMs,
  renderStartedAtMs,
  renderStatus,
  settingsDisabled = false,
  result,
  failure,
  dimmed = false,
  documentId = "active-document",
  mode,
  viewer = EMPTY_VIEWER,
  meshColor = null,
  keybindings,
  mouseMapping,
  annotationPersistence = { status: "saved" },
  cameraBookmarks = [], cameraBookmarkNotice = null,
  onSaveCameraBookmark, onDeleteCameraBookmark,
  onCancel,
  onRetryAnnotationPersistence,
  onExportAnnotationMetadata,
  onLayoutAction,
  onModeChange,
  onScreenshot,
  onMcpScreenshotCaptureAvailable, thumbnailPersistenceDestination = documentId,
  onThumbnail, onPresentationFailed, onPresentationReady,
  onShowConsole,
  onViewerAction,
}: ViewerPaneProps) {
  const modelViewer = useRef<ModelViewerHandle>(null);
  const firstPoint = useRef<Point3 | null>(null);
  const viewerMode = mode ?? viewer.mode;
  const [tool, setTool] = useState<ViewerTool>("navigate");
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [degradation, setDegradation] = useState<ViewerDegradation>({ edges: false, shadow: false });
  const geometry = result?.kind === "2d" || result?.kind === "3d" ? result : undefined;
  const visibleGeometry = viewerMode === "auto" || geometry?.kind === viewerMode
    ? geometry
    : undefined;
  const mismatch = viewerMode !== "auto" && geometry && geometry.kind !== viewerMode
    ? viewerMode
    : null;
  const measuredBounds = visibleGeometry?.kind === "3d" ? boundsLabel(visibleGeometry) : null;
  const bounds = visibleGeometry?.kind === "3d"
    ? visibleGeometry.stats.boundingBox as Bounds3 | undefined
    : undefined;
  const modelIdentity = viewer.modelIdentity ?? "";
  const { parts, partVisibility, setPartVisibility } = useViewerParts(
    visibleGeometry?.kind === "3d" ? visibleGeometry : undefined,
    documentId,
    modelIdentity,
  );
  const visibleKind = visibleGeometry?.kind;
  useEffect(() => {
    void documentId;
    void modelIdentity;
    firstPoint.current = null;
    setTool("navigate");
    setAnnotationDraft("");
    setNotice(null);
  }, [documentId, modelIdentity]);
  const captureThumbnail = useViewerThumbnail(modelViewer, viewer.presentation?.renderIdentity ?? "", thumbnailPersistenceDestination, onThumbnail);
  const presentationToken = viewer.presentation?.renderIdentity;
  const reportModelFrame = useModelFrameReport(presentationToken, onPresentationReady, captureThumbnail);
  const dispatchViewer = useCallback(
    (action: ViewerAction) => onViewerAction?.(action),
    [onViewerAction],
  );
  const changeMode = (next: ViewerMode) => {
    if (onModeChange) onModeChange(next);
    else dispatchViewer({ kind: "set-mode", documentId, mode: next });
  };
  const chooseTool = (next: ViewerTool) => {
    firstPoint.current = null;
    setNotice(null);
    setTool(next);
  };
  const pickPoint = (point: Point3) => {
    if (tool === "measure") {
      if (!firstPoint.current) {
        firstPoint.current = point;
        setNotice(messages.firstMeasurementPoint);
        return;
      }
      dispatchViewer({
        kind: "add-point-measurement",
        documentId,
        measurement: {
          id: nextItemId("measurement"),
          start: firstPoint.current,
          end: point,
        },
      });
      firstPoint.current = null;
      setNotice(null);
      return;
    }
    if (tool !== "annotate") return;
    const text = annotationDraft.trim();
    if (!text) {
      setNotice(messages.annotationTextRequired);
      return;
    }
    dispatchViewer({
      kind: "add-annotation",
      documentId,
      annotation: { id: nextItemId("annotation"), point, text },
    });
    setAnnotationDraft("");
    setNotice(null);
  };
  const captureScreenshot = useCallback(async () => {
    if (!onScreenshot) {
      setNotice(messages.screenshotDestinationUnavailable);
      return;
    }
    try {
      const bytes = await modelViewer.current?.capturePng();
      if (!bytes) throw new Error(messages.modelViewportUnavailable);
      await onScreenshot(bytes);
      setNotice(messages.screenshotCaptured);
    } catch {
      setNotice(messages.screenshotFailed);
    }
  }, [onScreenshot]);
  useMcpScreenshotCapture(modelViewer, visibleKind, onMcpScreenshotCaptureAvailable);
  const updateDegradation = (next: ViewerDegradation) => {
    setDegradation((current) => current.edges === next.edges && current.shadow === next.shadow
      ? current
      : next);
  };
  const retryAnnotationPersistence = () => {
    if (!onRetryAnnotationPersistence) return;
    void Promise.resolve(onRetryAnnotationPersistence()).catch(() => undefined);
  };
  const exportAnnotationMetadata = () => {
    if (!onExportAnnotationMetadata) return;
    void Promise.resolve(onExportAnnotationMetadata())
      .then(() => setNotice(messages.annotationMetadataExported))
      .catch(() => setNotice(messages.annotationMetadataExportFailed));
  };
  useEffect(() => {
    if (!keybindings || visibleKind !== "3d") return;
    const modifier = primaryModifierForPlatform();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.repeat
        || !globalThis.document?.activeElement?.closest(".viewer-panel")
      ) return;
      const matches = (binding: string) => matchesKeybinding(event, binding, modifier);
      const nextCamera = bounds && matches(keybindings.zoomViewerToFit)
        ? cameraToFit(viewer.camera, bounds)
        : bounds && matches(keybindings.axisFront)
          ? cameraForAxis(viewer.camera, bounds, "front")
          : bounds && matches(keybindings.axisRight)
            ? cameraForAxis(viewer.camera, bounds, "right")
            : bounds && matches(keybindings.axisTop)
              ? cameraForAxis(viewer.camera, bounds, "top")
              : matches(keybindings.togglePerspective)
                ? toggleProjection(viewer.camera)
                : null;
      if (nextCamera) {
        event.preventDefault();
        dispatchViewer({ kind: "set-camera", documentId, camera: nextCamera });
        return;
      }
      if (matches(keybindings.screenshotViewport)) {
        event.preventDefault();
        void captureScreenshot();
      }
    };
    globalThis.addEventListener?.("keydown", handleKeyDown);
    return () => globalThis.removeEventListener?.("keydown", handleKeyDown);
  }, [bounds, captureScreenshot, dispatchViewer, documentId, keybindings, viewer.camera, visibleKind]);
  return (
    <section
      className={`viewer-panel${visibleGeometry?.kind === "3d" ? " viewer-panel-with-toolbar" : ""}`}
      aria-label={messages.viewerRegion} data-geometry-identity={visibleGeometry?.kind === "3d" ? visibleGeometry.mesh.geometryIdentity : visibleGeometry?.geometryIdentity}
    >
      <div className="panel-heading viewer-heading">
        <span>{messages.viewerRegion}</span>
        <div className="viewer-heading-actions">
          <label className="viewer-mode-picker">
            <span>{messages.viewerMode}</span>
            <select
              aria-label={messages.viewerMode}
              value={viewerMode}
              onChange={(event) => changeMode(event.currentTarget.value as ViewerMode)}
            >
              <option value="auto">{messages.viewerModeAuto}</option>
              <option value="2d">{messages.viewerMode2d}</option>
              <option value="3d">{messages.viewerMode3d}</option>
            </select>
          </label>
          {visibleGeometry && quality === "preview" && renderStatus === "success" && (
            <span className="quality-badge">{messages.previewQuality}</span>
          )}
          {!narrow && <button aria-label={messages.collapseViewer} className="panel-action" onClick={() => onLayoutAction({ kind: "toggle-panel", panel: "viewer" })} type="button"><span aria-hidden="true">−</span></button>}
          {!narrow && <button aria-label={maximized ? messages.restoreViewer : messages.maximizeViewer} className="panel-action" onClick={() => onLayoutAction({ kind: "toggle-maximize", region: "viewer" })} type="button"><span aria-hidden="true">{maximized ? "↙" : "↗"}</span></button>}
        </div>
      </div>
      {visibleGeometry?.kind === "3d" && (
        <ViewerToolbar
          bounds={bounds}
          camera={viewer.camera}
          clipping={viewer.clipping}
          furniture={viewer.furniture}
          settingsDisabled={settingsDisabled}
          tool={tool}
          onCameraChange={(camera) => dispatchViewer({ kind: "set-camera", documentId, camera })}
          onClippingChange={(clipping) => dispatchViewer({ kind: "set-clipping", documentId, clipping })}
          onFurnitureChange={(furniture, enabled) => dispatchViewer({ kind: "set-furniture", documentId, furniture, enabled })}
          onScreenshot={() => void captureScreenshot()}
          onToolChange={chooseTool}
        />
      )}
      {visibleGeometry?.kind === "3d" && onSaveCameraBookmark && onDeleteCameraBookmark && (
        <ViewerCameraBookmarks bookmarks={cameraBookmarks} camera={viewer.camera} onDelete={onDeleteCameraBookmark} onRecall={(camera) => dispatchViewer({ kind: "set-camera", documentId, camera })} onSave={onSaveCameraBookmark} />
      )}
      <div className="viewer-content">
        <div className="viewer-model-surface" data-testid="viewer-model-surface">
          <Suspense fallback={<div className="surface-loading" role="status">{messages.loadingViewer}</div>}>
            {visibleGeometry?.kind === "2d" ? (
              <SvgViewer result={visibleGeometry} onPresentationFailed={onPresentationFailed} onPresentationReady={onPresentationReady} onThumbnail={onThumbnail} presentationToken={presentationToken} />
            ) : visibleGeometry?.kind === "3d" ? (
              <ModelViewer
                annotations={viewer.annotations} camera={viewer.camera}
                clipping={viewer.clipping}
                colors={colors} dimmed={dimmed}
                furniture={viewer.furniture}
                measurements={viewer.measurements}
                meshColor={meshColor}
                mouseMapping={mouseMapping}
                partVisibility={partVisibility}
                onCameraChange={(camera) => dispatchViewer({ kind: "set-camera", documentId, camera })}
                onDegradationChange={updateDegradation}
                onPresentationFailed={onPresentationFailed}
                onPointPick={pickPoint}
                onFrameRendered={reportModelFrame}
                ref={modelViewer}
                result={visibleGeometry} presentationToken={presentationToken}
                tool={tool}
              />
            ) : !mismatch ? (
              <ModelViewer
                colors={colors}
                emptyMessage={engineChecking
                  ? messages.modelCheckingEngine
                  : engineAvailable
                    ? messages.modelAwaitingRender
                    : messages.modelAwaitingEngine}
                ref={modelViewer}
              />
            ) : null}
          </Suspense>
          {measuredBounds && <output className="bounds-readout">{measuredBounds}</output>}
        </div>
        {visibleGeometry?.kind === "3d" && (
          <ViewerDetailsPanel
            annotations={viewer.annotations}
            annotationDraft={annotationDraft}
            measurements={viewer.measurements}
            parts={parts}
            partVisibility={partVisibility}
            onAnnotationDraftChange={setAnnotationDraft}
            onDeleteAnnotation={(annotationId) => dispatchViewer({ kind: "delete-annotation", documentId, annotationId })}
            onDeleteMeasurement={(measurementId) => dispatchViewer({ kind: "delete-measurement", documentId, measurementId })}
            onPartVisibilityChange={setPartVisibility}
          />
        )}
      </div>
      {mismatch && <p className="viewer-empty" role="status">{messages.viewerModeMismatch(mismatch)}</p>}
      {failure && (
        <button aria-label={messages.showRenderError} className="viewer-error-badge" onClick={onShowConsole} type="button">
          {messages.renderErrorBadge}
        </button>
      )}
      {(renderStatus === "rendering"
        || annotationPersistence.status !== "saved"
        || degradation.edges
        || degradation.shadow) && (
        <div className={`viewer-transient-stack${visibleGeometry?.kind === "3d" ? " viewer-transient-stack-with-toolbar" : ""}`}>
        {annotationPersistence.status !== "saved" && (
          <section className="viewer-annotation-persistence" role="alert">
          <p>{annotationPersistence.status === "unsaved"
            ? messages.annotationChangesUnsaved
            : annotationPersistence.status === "load-error-unsaved"
              ? messages.annotationMetadataLoadFailedWithChanges
              : messages.annotationMetadataLoadFailed}</p>
          <div>
            <button onClick={retryAnnotationPersistence} type="button">
              {annotationPersistence.status === "unsaved"
                || annotationPersistence.status === "load-error-unsaved"
                ? messages.retrySavingAnnotations
                : messages.retryLoadingAnnotations}
            </button>
            {onExportAnnotationMetadata ? (
              <button onClick={exportAnnotationMetadata} type="button">
                {messages.exportCurrentAnnotations}
              </button>
            ) : <span>{messages.annotationExportUnavailable}</span>}
          </div>
          </section>
        )}
        {renderStatus === "rendering" && (
          <RenderProgressOverlay
            key={renderJobId ?? "rendering"}
            onCancel={onCancel}
            startedAtMonotonicMs={renderStartedAtMonotonicMs}
            startedAtMs={renderStartedAtMs}
          />
        )}
        {(degradation.edges || degradation.shadow) && (
          <p className="viewer-degradation" role="status">{messages.largeMeshDegraded}</p>
        )}
        </div>
      )}
      {notice && <p className="viewer-notice" role="status">{notice}</p>}
      {cameraBookmarkNotice && <p className="viewer-notice" role="status">{cameraBookmarkNotice}</p>}
    </section>
  );
}
