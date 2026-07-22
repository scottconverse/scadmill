import type { RenderSuccess3D } from "../../application/engine/contracts";
import type { Point3 } from "../../application/viewer/measurements";
import type {
  PointMeasurement,
  ViewerAnnotation,
  ViewerCameraState,
  ViewerClippingState,
  ViewerFurnitureState,
} from "../../application/viewer/viewer-state";
import type { ModelMeshParser } from "./model-viewer-defaults";
import type { MouseButton } from "./model-viewer-runtime";
import type { ViewerTool } from "./ViewerToolbar";
import type { ViewerDegradation } from "./viewer-furniture";
import type { ViewerThemeColors } from "./viewer-theme";

export interface ModelViewerProps {
  readonly result?: RenderSuccess3D; readonly emptyMessage?: string;
  readonly colors: ViewerThemeColors; readonly camera?: ViewerCameraState;
  readonly clipping?: ViewerClippingState;
  readonly furniture?: ViewerFurnitureState; readonly measurements?: readonly PointMeasurement[];
  readonly annotations?: readonly ViewerAnnotation[]; readonly tool?: ViewerTool;
  readonly dimmed?: boolean; readonly meshColor?: string | null;
  readonly partVisibility?: Readonly<Record<string, boolean>>;
  readonly mouseMapping?: { readonly orbit: MouseButton; readonly pan: MouseButton }; readonly meshParser?: ModelMeshParser;
  readonly presentationToken?: string; readonly onCameraChange?: (camera: ViewerCameraState) => void;
  readonly onPointPick?: (point: Point3) => void; readonly onDegradationChange?: (degradation: ViewerDegradation) => void;
  readonly onFrameRendered?: (durationMs: number, presentationToken?: string) => void; readonly onPresentationFailed?: (presentationToken: string) => void;
}
