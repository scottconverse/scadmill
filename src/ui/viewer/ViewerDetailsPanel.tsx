import { pointDistance } from "../../application/viewer/measurements";
import type { RenderPart } from "../../application/engine/contracts";
import type {
  PointMeasurement,
  ViewerAnnotation,
} from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";

export interface ViewerDetailsPanelProps {
  readonly annotations: readonly ViewerAnnotation[];
  readonly annotationDraft: string;
  readonly measurements: readonly PointMeasurement[];
  readonly parts?: readonly RenderPart[];
  readonly partVisibility?: Readonly<Record<string, boolean>>;
  readonly onAnnotationDraftChange: (value: string) => void;
  readonly onDeleteAnnotation: (id: string) => void;
  readonly onDeleteMeasurement: (id: string) => void;
  readonly onPartVisibilityChange?: (id: string, visible: boolean) => void;
}

function measurementLabel(measurement: PointMeasurement): string {
  return messages.millimeters(pointDistance(measurement.start, measurement.end).toFixed(4));
}

export function ViewerDetailsPanel({
  annotations,
  annotationDraft,
  measurements,
  parts = [],
  partVisibility = {},
  onAnnotationDraftChange,
  onDeleteAnnotation,
  onDeleteMeasurement,
  onPartVisibilityChange,
}: ViewerDetailsPanelProps) {
  return (
    <aside className="viewer-details">
      {parts.length > 1 && (
        <section aria-labelledby="parts-heading">
          <h3 id="parts-heading">{messages.parts}</h3>
          <p>{messages.partColorsFromModel}</p>
          <ol className="viewer-parts-list">
            {parts.map((part) => (
              <li key={part.id}>
                <label>
                  <input
                    aria-label={messages.partVisibility(part.name)}
                    checked={partVisibility[part.id] !== false}
                    onChange={(event) => onPartVisibilityChange?.(part.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span
                    aria-hidden="true"
                    className="viewer-part-color"
                    data-testid={`part-color-${part.id}`}
                    style={{ backgroundColor: part.color.slice(0, 7) }}
                  />
                  <span>{part.name}</span>
                </label>
              </li>
            ))}
          </ol>
        </section>
      )}
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
