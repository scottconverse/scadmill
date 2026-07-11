import { pointDistance } from "../../application/viewer/measurements";
import type {
  PointMeasurement,
  ViewerAnnotation,
} from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";
import type { OverlayPosition } from "./model-viewer-runtime";

export interface SpatialOverlays {
  readonly measurements: ReadonlyMap<string, OverlayPosition>;
  readonly annotations: ReadonlyMap<string, OverlayPosition>;
}

interface ModelViewerOverlaysProps {
  readonly measurements: readonly PointMeasurement[];
  readonly annotations: readonly ViewerAnnotation[];
  readonly positions: SpatialOverlays;
  readonly measurementColor?: string;
  readonly annotationColor?: string;
}

export function ModelViewerOverlays({
  measurements,
  annotations,
  positions,
  measurementColor,
  annotationColor,
}: ModelViewerOverlaysProps) {
  return <>
    {measurements.map((measurement) => {
      const position = positions.measurements.get(measurement.id);
      return position ? (
        <span
          aria-hidden="true"
          className="viewer-spatial-label viewer-measurement-label"
          key={measurement.id}
          style={{ left: position.left, top: position.top, color: measurementColor }}
        >{messages.millimeters(pointDistance(measurement.start, measurement.end).toFixed(4))}</span>
      ) : null;
    })}
    {annotations.map((annotation) => {
      const position = positions.annotations.get(annotation.id);
      return position ? (
        <span
          aria-hidden="true"
          className="viewer-spatial-label viewer-annotation-label"
          key={annotation.id}
          style={{ left: position.left, top: position.top, color: annotationColor }}
        >{annotation.text}</span>
      ) : null;
    })}
  </>;
}
