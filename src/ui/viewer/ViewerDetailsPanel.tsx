import { pointDistance } from "../../application/viewer/measurements";
import type {
  PointMeasurement,
  ViewerAnnotation,
} from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";

export interface ViewerDetailsPanelProps {
  readonly annotations: readonly ViewerAnnotation[];
  readonly annotationDraft: string;
  readonly measurements: readonly PointMeasurement[];
  readonly onAnnotationDraftChange: (value: string) => void;
  readonly onDeleteAnnotation: (id: string) => void;
  readonly onDeleteMeasurement: (id: string) => void;
}

function measurementLabel(measurement: PointMeasurement): string {
  return `${pointDistance(measurement.start, measurement.end).toFixed(4)} mm`;
}

export function ViewerDetailsPanel({
  annotations,
  annotationDraft,
  measurements,
  onAnnotationDraftChange,
  onDeleteAnnotation,
  onDeleteMeasurement,
}: ViewerDetailsPanelProps) {
  return (
    <aside className="viewer-details">
      <section aria-labelledby="measurement-heading">
        <h3 id="measurement-heading">{messages.measurements}</h3>
        {measurements.length === 0 ? <p>{messages.noMeasurements}</p> : (
          <ol>
            {measurements.map((measurement) => {
              const label = measurementLabel(measurement);
              return (
                <li key={measurement.id}>
                  <output>{label}</output>
                  <button aria-label={messages.deleteMeasurement(label)} onClick={() => onDeleteMeasurement(measurement.id)} type="button">×</button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section aria-labelledby="annotation-heading">
        <h3 id="annotation-heading">{messages.annotations}</h3>
        <label>
          <span>{messages.annotationText}</span>
          <input
            aria-label={messages.annotationText}
            maxLength={240}
            onChange={(event) => onAnnotationDraftChange(event.currentTarget.value)}
            type="text"
            value={annotationDraft}
          />
        </label>
        <p>{messages.annotationPlacementHelp}</p>
        {annotations.length === 0 ? <p>{messages.noAnnotations}</p> : (
          <ol>
            {annotations.map((annotation) => (
              <li key={annotation.id}>
                <span>{annotation.text}</span>
                <button aria-label={messages.deleteAnnotation(annotation.text)} onClick={() => onDeleteAnnotation(annotation.id)} type="button">×</button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}
