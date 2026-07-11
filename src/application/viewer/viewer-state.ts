import type { Point3 } from "./measurements";
import type { Quality, RenderSuccess3D } from "../engine/contracts";

export type ProjectionMode = "perspective" | "orthographic";

export interface ViewerCameraState {
  readonly projection: ProjectionMode;
  readonly position: Point3;
  readonly target: Point3;
  readonly up: Point3;
  readonly zoom: number;
}

export interface PointMeasurement {
  readonly id: string;
  readonly start: Point3;
  readonly end: Point3;
}

export interface ViewerAnnotation {
  readonly id: string;
  readonly point: Point3;
  readonly text: string;
}

export type ViewerFurniture = "grid" | "axes" | "edges" | "shadow";

export interface ViewerFurnitureState {
  readonly grid: boolean;
  readonly axes: boolean;
  readonly edges: boolean;
  readonly shadow: boolean;
}

export interface ViewerPresentation {
  readonly modelIdentity: string;
  readonly quality: Quality;
  readonly result: RenderSuccess3D;
}

export interface ViewerDocumentState {
  readonly camera: ViewerCameraState;
  readonly modelIdentity?: string;
  readonly furniture: ViewerFurnitureState;
  readonly presentation?: ViewerPresentation;
  readonly measurements: readonly PointMeasurement[];
  readonly annotations: readonly ViewerAnnotation[];
}

export interface ViewerState {
  readonly documents: ReadonlyMap<string, ViewerDocumentState>;
}

export type ViewerAction =
  | { readonly kind: "set-camera"; readonly documentId: string; readonly camera: ViewerCameraState }
  | {
      readonly kind: "set-furniture";
      readonly documentId: string;
      readonly furniture: ViewerFurniture;
      readonly enabled: boolean;
    }
  | { readonly kind: "model-changed"; readonly documentId: string; readonly modelIdentity: string }
  | {
      readonly kind: "present-result";
      readonly documentId: string;
      readonly modelIdentity: string;
      readonly quality: Quality;
      readonly result: RenderSuccess3D;
    }
  | {
      readonly kind: "add-point-measurement";
      readonly documentId: string;
      readonly measurement: PointMeasurement;
    }
  | { readonly kind: "delete-measurement"; readonly documentId: string; readonly measurementId: string }
  | {
      readonly kind: "add-annotation";
      readonly documentId: string;
      readonly annotation: ViewerAnnotation;
    }
  | {
      readonly kind: "replace-annotations";
      readonly documentId: string;
      readonly annotations: readonly ViewerAnnotation[];
    }
  | { readonly kind: "delete-annotation"; readonly documentId: string; readonly annotationId: string };

const defaultCamera: ViewerCameraState = {
  projection: "perspective",
  position: [28, 24, 28],
  target: [0, 0, 0],
  up: [0, 0, 1],
  zoom: 1,
};

export function createDefaultViewerCamera(): ViewerCameraState {
  return cloneCamera(defaultCamera);
}

function clonePoint(point: Point3): [number, number, number] {
  return [...point];
}

function cloneCamera(camera: ViewerCameraState): ViewerCameraState {
  if (
    ![...camera.position, ...camera.target, ...camera.up, camera.zoom].every(Number.isFinite)
    || camera.zoom <= 0
  ) {
    throw new Error("Viewer camera values must be finite and zoom must be positive.");
  }
  return {
    ...camera,
    position: clonePoint(camera.position),
    target: clonePoint(camera.target),
    up: clonePoint(camera.up),
  };
}

function emptyDocument(): ViewerDocumentState {
  return {
    camera: createDefaultViewerCamera(),
    furniture: { grid: true, axes: true, edges: false, shadow: false },
    measurements: [],
    annotations: [],
  };
}

function requireIdentity(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
}

function cloneAnnotation(annotation: ViewerAnnotation): ViewerAnnotation {
  requireIdentity(annotation.id, "Annotation id");
  if (
    annotation.text.trim().length === 0
    || annotation.text.length > 240
    || !annotation.point.every(Number.isFinite)
  ) throw new Error("Annotation text and point must be valid.");
  return { ...annotation, point: clonePoint(annotation.point) };
}

function sameGeometry(
  left: RenderSuccess3D,
  right: RenderSuccess3D,
): boolean {
  return left.mesh.format === right.mesh.format
    && (
      left.mesh.bytes === right.mesh.bytes
      || (
        left.mesh.geometryIdentity !== undefined
        && left.mesh.geometryIdentity === right.mesh.geometryIdentity
      )
    );
}

function setDocument(
  state: ViewerState,
  documentId: string,
  document: ViewerDocumentState,
): ViewerState {
  requireIdentity(documentId, "Document id");
  const documents = new Map(state.documents);
  documents.set(documentId, document);
  return { documents };
}

export function createViewerState(): ViewerState {
  return { documents: new Map() };
}

export function viewerDocument(state: ViewerState, documentId: string): ViewerDocumentState {
  requireIdentity(documentId, "Document id");
  return state.documents.get(documentId) ?? emptyDocument();
}

export function reduceViewerState(state: ViewerState, action: ViewerAction): ViewerState {
  const current = viewerDocument(state, action.documentId);
  switch (action.kind) {
    case "set-camera":
      return setDocument(state, action.documentId, { ...current, camera: cloneCamera(action.camera) });
    case "set-furniture":
      return setDocument(state, action.documentId, {
        ...current,
        furniture: { ...current.furniture, [action.furniture]: action.enabled },
      });
    case "model-changed":
      requireIdentity(action.modelIdentity, "Model identity");
      if (current.modelIdentity === action.modelIdentity) return state;
      return setDocument(state, action.documentId, {
        ...current,
        camera: cloneCamera(current.camera),
        modelIdentity: action.modelIdentity,
        measurements: [],
      });
    case "present-result": {
      requireIdentity(action.modelIdentity, "Model identity");
      const modelIdentity = current.presentation
        && sameGeometry(current.presentation.result, action.result)
        ? current.presentation.modelIdentity
        : action.modelIdentity;
      return setDocument(state, action.documentId, {
        ...current,
        modelIdentity,
        presentation: {
          modelIdentity,
          quality: action.quality,
          result: action.result,
        },
        measurements: current.modelIdentity === modelIdentity ? current.measurements : [],
      });
    }
    case "add-point-measurement":
      requireIdentity(action.measurement.id, "Measurement id");
      return setDocument(state, action.documentId, {
        ...current,
        measurements: [
          ...current.measurements.filter(({ id }) => id !== action.measurement.id),
          {
            ...action.measurement,
            start: clonePoint(action.measurement.start),
            end: clonePoint(action.measurement.end),
          },
        ],
      });
    case "delete-measurement":
      return setDocument(state, action.documentId, {
        ...current,
        measurements: current.measurements.filter(({ id }) => id !== action.measurementId),
      });
    case "add-annotation":
      return setDocument(state, action.documentId, {
        ...current,
        annotations: [
          ...current.annotations.filter(({ id }) => id !== action.annotation.id),
          cloneAnnotation(action.annotation),
        ],
      });
    case "replace-annotations": {
      const ids = new Set<string>();
      const annotations = action.annotations.map((annotation) => {
        const cloned = cloneAnnotation(annotation);
        if (ids.has(cloned.id)) throw new Error("Annotation ids must be unique per file.");
        ids.add(cloned.id);
        return cloned;
      });
      return setDocument(state, action.documentId, { ...current, annotations });
    }
    case "delete-annotation":
      return setDocument(state, action.documentId, {
        ...current,
        annotations: current.annotations.filter(({ id }) => id !== action.annotationId),
      });
  }
}
