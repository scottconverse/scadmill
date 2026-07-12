import { useCallback, useMemo } from "react";

import type {
  Quality,
  RenderFailure,
  RenderResult,
} from "../../application/engine/contracts";
import type { WorkspaceLayoutAction } from "../../application/layout/workspace-layout";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { ThemeTokens } from "../../application/theme/theme-schema";
import type {
  ViewerAction,
  ViewerDocumentState,
} from "../../application/viewer/viewer-state";
import { useReadonlyStore } from "../use-readonly-store";
import { ViewerPane } from "./ViewerPane";

export interface ViewerPaneConnectorProps {
  readonly colors: ThemeTokens["viewer"];
  readonly dimmed: boolean;
  readonly documentId: string;
  readonly engineAvailable?: boolean;
  readonly engineChecking?: boolean;
  readonly failure?: RenderFailure;
  readonly maximized: boolean;
  readonly narrow: boolean;
  readonly quality?: Quality;
  readonly renderJobId?: string;
  readonly renderStatus: "idle" | "rendering" | "success" | "failure";
  readonly result?: RenderResult;
  readonly runtime: WorkbenchRuntime;
  readonly viewer: ViewerDocumentState;
  readonly onLayoutAction: (action: WorkspaceLayoutAction) => void;
  readonly onShowConsole: () => void;
}

export function ViewerPaneConnector({
  colors,
  dimmed,
  documentId,
  engineAvailable = true,
  engineChecking = false,
  failure,
  maximized,
  narrow,
  quality,
  renderJobId,
  renderStatus,
  result,
  runtime,
  viewer,
  onLayoutAction,
  onShowConsole,
}: ViewerPaneConnectorProps) {
  const preferences = useReadonlyStore(runtime.settings, (state) => state.profile.viewer);
  const profile = useReadonlyStore(runtime.settings, (state) => state.profile);
  const annotationPersistence = useReadonlyStore(
    runtime.annotationPersistence,
    (state) => state,
  );
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
      void runtime
        .dispatch({
          kind: "replace-settings",
          origin: "user",
          settings: {
            ...profile,
            viewer: { ...profile.viewer, projection: action.camera.projection },
          },
        })
        .then(() => runtime.dispatch({ kind: "update-viewer", origin: "user", action }))
        .catch(() => undefined);
      return;
    }
    void runtime.dispatch({ kind: "update-viewer", origin: "user", action });
  }, [preferences.projection, profile, runtime]);
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
      renderStatus={renderStatus}
      result={result}
      viewer={effectiveViewer}
      annotationPersistence={annotationPersistence}
      onRetryAnnotationPersistence={retryAnnotationPersistence}
      onExportAnnotationMetadata={runtime.artifacts.available
        ? exportAnnotationMetadata
        : undefined}
      onScreenshot={runtime.artifacts.available
        ? (bytes) => runtime.artifacts.save({
            suggestedName: `${documentId}.png`,
            bytes,
            mimeType: "image/png",
          }).then(() => undefined)
        : undefined}
      onCancel={cancel}
      onLayoutAction={onLayoutAction}
      onShowConsole={onShowConsole}
      onViewerAction={dispatchViewer}
    />
  );
}
