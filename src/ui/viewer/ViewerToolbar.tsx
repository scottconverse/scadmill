import type { Bounds3 } from "../../application/viewer/measurements";
import {
  cameraForAxis,
  cameraToFit,
  toggleProjection,
  type AxisView,
} from "../../application/viewer/camera";
import {
  createDefaultViewerCamera,
  type ViewerCameraState,
  type ViewerClippingState,
  type ViewerFurniture,
  type ViewerFurnitureState,
} from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";
import "./viewer-section.css";

export type ViewerTool = "navigate" | "measure" | "annotate";

export interface ViewerToolbarProps {
  readonly bounds?: Bounds3;
  readonly camera: ViewerCameraState;
  readonly clipping: ViewerClippingState;
  readonly furniture: ViewerFurnitureState;
  readonly settingsDisabled?: boolean;
  readonly tool: ViewerTool;
  readonly onCameraChange: (camera: ViewerCameraState) => void;
  readonly onClippingChange: (clipping: ViewerClippingState) => void;
  readonly onFurnitureChange: (furniture: ViewerFurniture, enabled: boolean) => void;
  readonly onScreenshot: () => void;
  readonly onToolChange: (tool: ViewerTool) => void;
}

const AXIS_BUTTONS: readonly { axis: AxisView; label: string; short: string }[] = [
  { axis: "top", label: messages.topView, short: messages.viewerTopShort },
  { axis: "bottom", label: messages.bottomView, short: messages.viewerBottomShort },
  { axis: "front", label: messages.frontView, short: messages.viewerFrontShort },
  { axis: "back", label: messages.backView, short: messages.viewerBackShort },
  { axis: "left", label: messages.leftView, short: messages.viewerLeftShort },
  { axis: "right", label: messages.rightView, short: messages.viewerRightShort },
];

const FURNITURE: readonly { key: ViewerFurniture; label: string }[] = [
  { key: "grid", label: messages.showGrid },
  { key: "axes", label: messages.showAxes },
  { key: "edges", label: messages.showEdges },
  { key: "shadow", label: messages.showShadow },
];

export function ViewerToolbar({
  bounds,
  camera,
  clipping,
  furniture,
  settingsDisabled = false,
  tool,
  onCameraChange,
  onClippingChange,
  onFurnitureChange,
  onScreenshot,
  onToolChange,
}: ViewerToolbarProps) {
  const axisIndex = clipping.axis === "x" ? 0 : clipping.axis === "y" ? 1 : 2;
  const axisMinimum = bounds?.min[axisIndex] ?? 0;
  const axisMaximum = bounds?.max[axisIndex] ?? 0;
  const axisStep = Math.max((axisMaximum - axisMinimum) / 200, 0.001);
  return (
    <div aria-label={messages.viewerControls} className="viewer-toolbar" role="toolbar">
      <button
        aria-label={messages.resetView}
        onClick={() => onCameraChange({
          ...createDefaultViewerCamera(),
          projection: camera.projection,
        })}
        type="button"
      >{messages.viewerResetShort}</button>
      <button aria-label={messages.fitModel} disabled={!bounds} onClick={() => bounds && onCameraChange(cameraToFit(camera, bounds))} type="button">{messages.viewerFitShort}</button>
      {AXIS_BUTTONS.map(({ axis, label, short }) => (
        <button aria-label={label} disabled={!bounds} key={axis} onClick={() => bounds && onCameraChange(cameraForAxis(camera, bounds, axis))} type="button">{short}</button>
      ))}
      <button
        aria-label={camera.projection === "perspective" ? messages.useOrthographicProjection : messages.usePerspectiveProjection}
        disabled={settingsDisabled}
        onClick={() => onCameraChange(toggleProjection(camera))}
        type="button"
      >{camera.projection === "perspective" ? messages.viewerOrthographicShort : messages.viewerPerspectiveShort}</button>
      {FURNITURE.map(({ key, label }) => (
        <label className="viewer-toggle" key={key}>
          <input checked={furniture[key]} disabled={settingsDisabled} onChange={(event) => onFurnitureChange(key, event.currentTarget.checked)} type="checkbox" />
          <span>{label}</span>
        </label>
      ))}
      <label className="viewer-toggle">
        <input
          aria-label={messages.enableSectionView}
          checked={clipping.enabled}
          disabled={!bounds}
          onChange={(event) => onClippingChange({ ...clipping, enabled: event.currentTarget.checked })}
          type="checkbox"
        />
        <span>{messages.sectionView}</span>
      </label>
      <label className="viewer-section-control">
        <span>{messages.sectionAxis}</span>
        <select
          aria-label={messages.sectionAxis}
          disabled={!bounds}
          onChange={(event) => {
            const axis = event.currentTarget.value as ViewerClippingState["axis"];
            const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
            const offset = bounds ? (bounds.min[index] + bounds.max[index]) / 2 : 0;
            onClippingChange({ ...clipping, axis, offset });
          }}
          value={clipping.axis}
        >
          <option value="x">X</option><option value="y">Y</option><option value="z">Z</option>
        </select>
      </label>
      <label className="viewer-section-control">
        <span>{messages.sectionPosition}</span>
        <input
          aria-label={messages.sectionPosition}
          disabled={!bounds}
          max={axisMaximum}
          min={axisMinimum}
          onChange={(event) => onClippingChange({ ...clipping, offset: event.currentTarget.valueAsNumber })}
          step={axisStep}
          type="range"
          value={Math.min(axisMaximum, Math.max(axisMinimum, clipping.offset))}
        />
      </label>
      <button aria-label={messages.navigateModel} aria-pressed={tool === "navigate"} onClick={() => onToolChange("navigate")} type="button">{messages.viewerNavigateShort}</button>
      <button aria-label={messages.measurePoints} aria-pressed={tool === "measure"} onClick={() => onToolChange("measure")} type="button">{messages.viewerMeasureShort}</button>
      <button aria-label={messages.addAnnotation} aria-pressed={tool === "annotate"} onClick={() => onToolChange("annotate")} type="button">{messages.viewerAnnotationShort}</button>
      <button aria-label={messages.captureViewport} onClick={onScreenshot} type="button">{messages.viewerPngShort}</button>
    </div>
  );
}
