import { createDefaultViewerCamera, type ViewerDocumentState } from "../../application/viewer/viewer-state";

export const EMPTY_VIEWER: ViewerDocumentState = {
  camera: createDefaultViewerCamera(),
  mode: "auto",
  furniture: { grid: true, axes: true, edges: false, shadow: false },
  clipping: { enabled: false, axis: "x", offset: 0 },
  measurements: [],
  annotations: [],
};
