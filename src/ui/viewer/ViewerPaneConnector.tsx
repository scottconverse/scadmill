import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  Quality,
  RenderFailure,
  RenderResult,
} from "../../application/engine/contracts";
import type { ProjectFileContent } from "../../application/files/project-snapshot";
import { isSha256GeometryIdentity } from "../../application/geometry/geometry-identity";
import type { WorkspaceLayoutAction } from "../../application/layout/workspace-layout";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { ThemeTokens } from "../../application/theme/theme-schema";
import type {
  ViewerAction,
  ViewerDocumentState,
} from "../../application/viewer/viewer-state";
import {
  type CameraBookmark,
  parseCameraBookmarks,
  serializeCameraBookmarks,
} from "../../application/viewer/camera-bookmarks";
import { messages } from "../../messages/en";
import { AnimationBar } from "../animation/AnimationBar";
import { useReadonlyStore } from "../use-readonly-store";
import { ViewerPane } from "./ViewerPane";

export interface ViewerPaneConnectorProps {
  readonly colors: ThemeTokens["viewer"];
  readonly dimmed: boolean;
  readonly documentId: string;
  readonly entryFile?: string;
  readonly engineAvailable?: boolean;
  readonly engineChecking?: boolean;
  readonly failure?: RenderFailure;
  readonly maximized: boolean;
  readonly narrow: boolean;
  readonly quality?: Quality;
  readonly renderJobId?: string;
  readonly renderStartedAtMonotonicMs?: number;
  readonly renderStartedAtMs?: number;
  readonly renderStatus: "idle" | "rendering" | "success" | "failure";
  readonly result?: RenderResult;
  readonly runtime: WorkbenchRuntime;
  readonly source?: string;
  readonly sourceFiles?: ReadonlyMap<string, ProjectFileContent>;
  readonly viewer: ViewerDocumentState;
  readonly onLayoutAction: (action: WorkspaceLayoutAction) => void;
  readonly onShowConsole: () => void;
  readonly onPresentationFailed?: (token: string) => void;
  readonly onPresentationReady?: (identity: string) => void;
  readonly waitForPresentation?: (token?: string, signal?: AbortSignal) => Promise<void>;
  readonly onScreenshotCaptured?: (bytes: Uint8Array) => void;
  readonly onMcpScreenshotCaptureAvailable?: (capture: ((width: number, height: number) => Promise<Uint8Array>) | undefined) => void;
}

export function ViewerPaneConnector({
  colors,
  dimmed,
  documentId,
  entryFile,
  engineAvailable = true,
  engineChecking = false,
  failure,
  maximized,
  narrow,
  quality,
  renderJobId,
  renderStartedAtMonotonicMs,
  renderStartedAtMs,
  renderStatus,
  result,
  runtime,
  source = "",
  sourceFiles,
  viewer,
  onLayoutAction,
  onShowConsole,
  onPresentationFailed,
  onPresentationReady,
  waitForPresentation,
  onScreenshotCaptured,
  onMcpScreenshotCaptureAvailable,
}: ViewerPaneConnectorProps) {
  const preferences = useReadonlyStore(runtime.settings, (state) => state.profile.viewer);
  const profile = useReadonlyStore(runtime.settings, (state) => state.profile);
  const settingsDisabled = useReadonlyStore(
    runtime.settings,
    (state) => state.persistenceStatus.status === "load-error",
  );
  const annotationPersistence = useReadonlyStore(
    runtime.annotationPersistence,
    (state) => state,
  );
  const project = useReadonlyStore(runtime.project, (state) => state);
  const workspaceIdentity = project.snapshot.workspaceIdentity;
  const [bookmarkState, setBookmarkState] = useState<{
    readonly workspaceIdentity: string;
    readonly bookmarks: readonly CameraBookmark[];
  }>({ workspaceIdentity, bookmarks: [] });
  const [bookmarkNotice, setBookmarkNotice] = useState<string | null>(null);
  useEffect(() => {
    try {
      const serialized = runtime.cameraBookmarks.load(workspaceIdentity);
      setBookmarkState({
        workspaceIdentity,
        bookmarks: serialized ? parseCameraBookmarks(serialized) : [],
      });
      setBookmarkNotice(null);
    } catch {
      setBookmarkState({ workspaceIdentity, bookmarks: [] });
      setBookmarkNotice(messages.cameraBookmarksCouldNotBeLoaded);
    }
  }, [runtime.cameraBookmarks, workspaceIdentity]);
  const cameraBookmarks = bookmarkState.workspaceIdentity === workspaceIdentity
    ? bookmarkState.bookmarks
    : [];
  const persistCameraBookmarks = useCallback((bookmarks: readonly CameraBookmark[]) => {
    try {
      runtime.cameraBookmarks.save(workspaceIdentity, serializeCameraBookmarks(bookmarks));
      setBookmarkState({ workspaceIdentity, bookmarks });
      setBookmarkNotice(null);
    } catch {
      setBookmarkNotice(messages.cameraBookmarksCouldNotBeSaved);
    }
  }, [runtime.cameraBookmarks, workspaceIdentity]);
  const thumbnailWorkspaceSupported = runtime.renderThumbnails.supportsWorkspace(
    project.snapshot.workspaceIdentity,
  );
  const documents = useReadonlyStore(runtime.documents, (state) => state);
  const thumbnailDocumentPath = documents.documents.find(({ id }) => id === documentId)?.path ?? "Untitled";
  const thumbnailPersistenceDestination = JSON.stringify([
    project.snapshot.workspaceIdentity,
    thumbnailDocumentPath,
  ]);
  const effectiveViewer = useMemo<ViewerDocumentState>(() => ({
    ...viewer,
    camera: { ...viewer.camera, projection: preferences.projection },
    furniture: {
      grid: preferences.showGrid,
      axes: preferences.showAxes,
      edges: preferences.showEdges,
      shadow: preferences.showShadow,
    },
  }), [preferences, viewer]);
  const dispatchViewer = useCallback((action: ViewerAction) => {
    if (settingsDisabled && (
      action.kind === "set-furniture"
      || (action.kind === "set-camera" && action.camera.projection !== preferences.projection)
    )) return;
    if (action.kind === "set-furniture") {
      const setting = {
        grid: "showGrid",
        axes: "showAxes",
        edges: "showEdges",
        shadow: "showShadow",
      } as const;
      void runtime.dispatch({
        kind: "replace-settings",
        origin: "user",
        settings: {
          ...profile,
          viewer: { ...profile.viewer, [setting[action.furniture]]: action.enabled },
        },
      }).catch(() => undefined);
      return;
    }
    if (action.kind === "set-camera" && action.camera.projection !== preferences.projection) {
      void runtime.dispatch({
        kind: "replace-settings",
        origin: "user",
        settings: {
          ...profile,
          viewer: { ...profile.viewer, projection: action.camera.projection },
        },
      }).catch(() => undefined);
      return;
    }
    void runtime.dispatch({ kind: "update-viewer", origin: "user", action });
  }, [preferences.projection, profile, runtime, settingsDisabled]);
  const cancel = useCallback(() => {
    void runtime.dispatch({ kind: "cancel-render", origin: "user" });
  }, [runtime]);
  const retryAnnotationPersistence = useCallback(
    () => runtime.dispatch({ kind: "retry-annotation-persistence", origin: "user" }),
    [runtime],
  );
  const exportAnnotationMetadata = useCallback(
    () => runtime.dispatch({ kind: "export-annotation-metadata", origin: "user" }),
    [runtime],
  );

  return (
    <div className="viewer-animation-surface">
    <ViewerPane
      colors={colors}
      dimmed={dimmed}
      documentId={documentId}
      engineAvailable={engineAvailable}
      engineChecking={engineChecking}
      failure={failure}
      keybindings={profile.keybindings}
      maximized={maximized}
      meshColor={preferences.meshColor}
      mouseMapping={{ orbit: preferences.orbitButton, pan: preferences.panButton }}
      narrow={narrow}
      quality={quality}
      renderJobId={renderJobId}
      renderStartedAtMonotonicMs={renderStartedAtMonotonicMs}
      renderStartedAtMs={renderStartedAtMs}
      renderStatus={renderStatus}
      result={result}
      settingsDisabled={settingsDisabled}
      thumbnailPersistenceDestination={thumbnailPersistenceDestination}
      viewer={effectiveViewer}
      annotationPersistence={annotationPersistence}
      cameraBookmarks={cameraBookmarks}
      cameraBookmarkNotice={bookmarkNotice}
      onSaveCameraBookmark={(name, camera) => {
        const matching = cameraBookmarks.find(
          (bookmark) => bookmark.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
        );
        const next = [
          ...cameraBookmarks.filter(({ id }) => id !== matching?.id),
          {
            id: matching?.id ?? (globalThis.crypto?.randomUUID?.() ?? `camera-${Date.now()}`),
            name: name.trim(),
            camera,
          },
        ];
        persistCameraBookmarks(next);
      }}
      onDeleteCameraBookmark={(bookmarkId) => persistCameraBookmarks(
        cameraBookmarks.filter(({ id }) => id !== bookmarkId),
      )}
      onRetryAnnotationPersistence={retryAnnotationPersistence}
      onExportAnnotationMetadata={runtime.artifacts.available
        ? exportAnnotationMetadata
        : undefined}
      onScreenshot={runtime.artifacts.available
        ? (bytes) => {
            onScreenshotCaptured?.(bytes);
            return runtime.artifacts.save({
              suggestedName: `${documentId}.png`,
              bytes,
              mimeType: "image/png",
            }).then(() => undefined);
          }
        : undefined}
      onMcpScreenshotCaptureAvailable={onMcpScreenshotCaptureAvailable}
      onPresentationFailed={onPresentationFailed}
      onPresentationReady={onPresentationReady}
      onThumbnail={(bytes) => {
        const snapshotId = viewer.presentation?.renderIdentity;
        if (snapshotId) {
          void runtime.dispatch({
            kind: "attach-model-history-thumbnail",
            origin: "system",
            workspaceIdentity: project.snapshot.workspaceIdentity,
            snapshotId,
            pngBytes: bytes,
          }).catch(() => undefined);
        }
        if (!thumbnailWorkspaceSupported) return;
        const result = viewer.presentation?.result;
        const renderIdentity = result?.kind === "2d"
          ? result.geometryIdentity
          : result?.kind === "3d"
            ? result.mesh.geometryIdentity
            : undefined;
        if (!isSha256GeometryIdentity(renderIdentity)) return;
        runtime.renderThumbnails.save(project.snapshot.workspaceIdentity, {
          documentPath: thumbnailDocumentPath,
          renderIdentity,
          capturedAt: new Date().toISOString(),
          pngBytes: bytes,
        });
      }}
      onCancel={cancel}
      onLayoutAction={onLayoutAction}
      onShowConsole={onShowConsole}
      onViewerAction={dispatchViewer}
    />
    <AnimationBar documentId={documentId} engineAvailable={engineAvailable} entryFile={entryFile} runtime={runtime} source={source} sourceFiles={sourceFiles} waitForPresentation={waitForPresentation} />
    </div>
  );
}
