import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type { RenderSuccess2D } from "../../application/engine/contracts";
import { sanitizeEngineSvg } from "../../application/viewer/engine-svg";
import {
  fitSvgViewport,
  zoomSvgViewportAt,
  type SvgViewportState,
  type ViewportSize,
} from "../../application/viewer/svg-viewport";
import { messages } from "../../messages/en";

export interface SvgViewerProps {
  readonly result: RenderSuccess2D;
}

function exactDimension(value: number): number {
  return Number(value.toFixed(6));
}

export function SvgViewer({ result }: SvgViewerProps) {
  const container = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState<ViewportSize | null>(null);
  const [viewport, setViewport] = useState<SvgViewportState | null>(null);
  const safeSvg = useMemo(() => {
    try {
      return sanitizeEngineSvg(result.svg, result.boundingBox);
    } catch {
      return null;
    }
  }, [result.svg, result.boundingBox]);
  const bounds = result.boundingBox;
  const width = exactDimension(bounds.max[0] - bounds.min[0]);
  const height = exactDimension(bounds.max[1] - bounds.min[1]);
  const fitViewport = useCallback(() => {
    if (!size) return;
    setViewport(fitSvgViewport(bounds, size, 0));
  }, [bounds, size]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const updateSize = (width: number, height: number) => {
      if (width > 0 && height > 0) setSize({ width, height });
    };
    updateSize(element.clientWidth, element.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (size) setViewport(fitSvgViewport(bounds, size, 0));
  }, [bounds, size]);

  const handleWheel = (event: ReactWheelEvent<HTMLButtonElement>) => {
    if (!viewport || !size) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 0.8 : 1.25;
    const localX = Number.isFinite(event.clientX - rect.left)
      ? event.clientX - rect.left
      : size.width / 2;
    const localY = Number.isFinite(event.clientY - rect.top)
      ? event.clientY - rect.top
      : size.height / 2;
    setViewport(
      zoomSvgViewportAt(
        viewport,
        size,
        { x: localX, y: localY },
        factor,
      ),
    );
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const previous = pointer.current;
    if (!previous || previous.id !== event.pointerId || !viewport) return;
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setViewport({
      center: [
        viewport.center[0] - deltaX * viewport.mmPerPixel,
        viewport.center[1] + deltaY * viewport.mmPerPixel,
      ],
      mmPerPixel: viewport.mmPerPixel,
    });
  };
  const handlePointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointer.current?.id === event.pointerId) pointer.current = null;
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!viewport || !size) return;
    if (event.key === "0") {
      event.preventDefault();
      fitViewport();
      return;
    }
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      setViewport(zoomSvgViewportAt(
        viewport,
        size,
        { x: size.width / 2, y: size.height / 2 },
        event.key === "-" ? 1.25 : 0.8,
      ));
      return;
    }
    const delta = 24 * viewport.mmPerPixel;
    const movement = event.key === "ArrowLeft"
      ? [-delta, 0]
      : event.key === "ArrowRight"
        ? [delta, 0]
        : event.key === "ArrowUp"
          ? [0, delta]
          : event.key === "ArrowDown"
            ? [0, -delta]
            : null;
    if (!movement) return;
    event.preventDefault();
    setViewport({
      ...viewport,
      center: [viewport.center[0] + movement[0], viewport.center[1] + movement[1]],
    });
  };

  if (!safeSvg) {
    return <p className="viewer-empty" role="alert">{messages.unsafeSvg}</p>;
  }

  const drawingCenter: [number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
  ];
  const fitted = size ? fitSvgViewport(bounds, size, 0) : null;
  const zoom = viewport && fitted ? fitted.mmPerPixel / viewport.mmPerPixel : 1;
  const translateX = viewport
    ? (drawingCenter[0] - viewport.center[0]) / viewport.mmPerPixel
    : 0;
  const translateY = viewport
    ? (viewport.center[1] - drawingCenter[1]) / viewport.mmPerPixel
    : 0;
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`;

  return (
    <div className="svg-viewer-shell">
      <button
        aria-label={messages.svgViewerRegion}
        className="svg-viewer"
        onKeyDown={handleKeyDown}
        onPointerCancel={handlePointerEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onWheel={handleWheel}
        ref={container}
        type="button"
      >
        <img
          alt={messages.svgDrawingAlt}
          draggable={false}
          src={source}
          style={{ transform: `translate(${translateX}px, ${translateY}px) scale(${zoom})` }}
        />
      </button>
      <div className="svg-viewer-controls">
        <button onClick={fitViewport} type="button">{messages.fitDrawing}</button>
        <output>{messages.drawingDimensions(width, height)}</output>
        <output data-testid="svg-scale">
          {messages.drawingScale(viewport?.mmPerPixel ?? fitted?.mmPerPixel ?? 1)}
        </output>
      </div>
    </div>
  );
}
