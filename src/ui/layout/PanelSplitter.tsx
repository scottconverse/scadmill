import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

export interface PanelSplitterProps {
  label: string;
  orientation: "horizontal" | "vertical";
  value: number;
  minimum: number;
  maximum: number;
  growthDirection: 1 | -1;
  onCommit(value: number): void;
  onPreview?(value: number | null): void;
}

interface DragState {
  readonly pointerId: number;
  readonly startCoordinate: number;
  readonly startValue: number;
}

const KEYBOARD_STEP = 8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

export function PanelSplitter({
  label,
  orientation,
  value,
  minimum,
  maximum,
  growthDirection,
  onCommit,
  onPreview,
}: PanelSplitterProps) {
  const drag = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const coordinate = (event: Pick<ReactPointerEvent, "clientX" | "clientY">) =>
    orientation === "vertical" ? event.clientX : event.clientY;
  const draggedValue = (event: Pick<ReactPointerEvent, "clientX" | "clientY">) => {
    const currentDrag = drag.current;
    if (!currentDrag) return value;
    const delta = coordinate(event) - currentDrag.startCoordinate;
    return clamp(currentDrag.startValue + delta * growthDirection, minimum, maximum);
  };

  return (
    <hr
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemax={maximum}
      aria-valuemin={minimum}
      aria-valuenow={preview ?? value}
      className={`panel-splitter panel-splitter-${orientation}`}
      onKeyDown={(event) => {
        let next: number | null = null;
        if (event.key === "Home") next = minimum;
        if (event.key === "End") next = maximum;
        const physicalStep = orientation === "vertical"
          ? event.key === "ArrowLeft"
            ? -KEYBOARD_STEP
            : event.key === "ArrowRight"
              ? KEYBOARD_STEP
              : null
          : event.key === "ArrowUp"
            ? -KEYBOARD_STEP
            : event.key === "ArrowDown"
              ? KEYBOARD_STEP
              : null;
        if (physicalStep !== null) {
          next = clamp(value + physicalStep * growthDirection, minimum, maximum);
        }
        if (next !== null && next !== value) {
          event.preventDefault();
          onCommit(next);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
        onPreview?.(null);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = {
          pointerId: event.pointerId,
          startCoordinate: coordinate(event),
          startValue: value,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const next = draggedValue(event);
        setPreview(next);
        onPreview?.(next);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const next = draggedValue(event);
        drag.current = null;
        setPreview(null);
        onPreview?.(null);
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (next !== value) onCommit(next);
      }}
      tabIndex={0}
    />
  );
}
