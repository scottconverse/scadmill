export type Point2 = readonly [number, number];

export interface Bounds2 {
  readonly min: Point2;
  readonly max: Point2;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface SvgViewportState {
  readonly center: Point2;
  readonly mmPerPixel: number;
}

function assertPositiveSize(size: ViewportSize): void {
  if (
    !Number.isFinite(size.width)
    || !Number.isFinite(size.height)
    || size.width <= 0
    || size.height <= 0
  ) {
    throw new Error("Viewport dimensions must be positive finite numbers.");
  }
}

function assertBounds(bounds: Bounds2): void {
  if (
    ![...bounds.min, ...bounds.max].every(Number.isFinite)
    || bounds.min.some((minimum, axis) => minimum > bounds.max[axis])
  ) {
    throw new Error("SVG bounds must be finite and ordered.");
  }
}

export function fitSvgViewport(
  bounds: Bounds2,
  size: ViewportSize,
  paddingPixels = 24,
): SvgViewportState {
  assertBounds(bounds);
  assertPositiveSize(size);
  if (!Number.isFinite(paddingPixels) || paddingPixels < 0) {
    throw new Error("Viewport padding must be a non-negative finite number.");
  }
  const availableWidth = size.width - paddingPixels * 2;
  const availableHeight = size.height - paddingPixels * 2;
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new Error("Viewport padding must leave a positive drawing area.");
  }
  const drawingWidth = bounds.max[0] - bounds.min[0];
  const drawingHeight = bounds.max[1] - bounds.min[1];
  const mmPerPixel = Math.max(
    drawingWidth / availableWidth,
    drawingHeight / availableHeight,
    Number.EPSILON,
  );
  return {
    center: [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
    ],
    mmPerPixel,
  };
}

export function modelPointAtScreen(
  viewport: SvgViewportState,
  size: ViewportSize,
  point: ScreenPoint,
): [number, number] {
  assertPositiveSize(size);
  if (
    !viewport.center.every(Number.isFinite)
    || !Number.isFinite(viewport.mmPerPixel)
    || viewport.mmPerPixel <= 0
    || !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
  ) {
    throw new Error("SVG viewport and screen coordinates must be finite and scaled positively.");
  }
  return [
    viewport.center[0] + (point.x - size.width / 2) * viewport.mmPerPixel,
    viewport.center[1] - (point.y - size.height / 2) * viewport.mmPerPixel,
  ];
}

export function zoomSvgViewportAt(
  viewport: SvgViewportState,
  size: ViewportSize,
  cursor: ScreenPoint,
  zoomFactor: number,
): SvgViewportState {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    throw new Error("SVG zoom factor must be a positive finite number.");
  }
  const anchor = modelPointAtScreen(viewport, size, cursor);
  const mmPerPixel = viewport.mmPerPixel * zoomFactor;
  return {
    center: [
      anchor[0] - (cursor.x - size.width / 2) * mmPerPixel,
      anchor[1] + (cursor.y - size.height / 2) * mmPerPixel,
    ],
    mmPerPixel,
  };
}
