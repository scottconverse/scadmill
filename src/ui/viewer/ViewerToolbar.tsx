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
  type ViewerFurniture,
  type ViewerFurnitureState,
} from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";

export type ViewerTool = "navigate" | "measure" | "annotate";

export interface ViewerToolbarProps {
  readonly bounds?: Bounds3;
  readonly camera: ViewerCameraState;
  readonly furniture: ViewerFurnitureState;
  readonly tool: ViewerTool;
  readonly onCameraChange: (camera: ViewerCameraState) => void;
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
  furniture,
  tool,
  onCameraChange,
  onFurnitureChange,
  onScreenshot,
  onToolChange,
}: ViewerToolbarProps) {
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
        onClick={() => onCameraChange(toggleProjection(camera))}
        type="button"
      >{camera.projection === "perspective" ? messages.viewerOrthographicShort : messages.viewerPerspectiveShort}</button>
      {FURNITURE.map(({ key, label }) => (
        <label className="viewer-toggle" key={key}>
          <input checked={furniture[key]} onChange={(event) => onFurnitureChange(key, event.currentTarget.checked)} type="checkbox" />
          <span>{label}</span>
        </label>
      ))}
      <button aria-label={messages.navigateModel} aria-pressed={tool === "navigate"} onClick={() => onToolChange("navigate")} type="button">{messages.viewerNavigateShort}</button>
      <button aria-label={messages.measurePoints} aria-pressed={tool === "measure"} onClick={() => onToolChange("measure")} type="button">{messages.viewerMeasureShort}</button>
      <button aria-label={messages.addAnnotation} aria-pressed={tool === "annotate"} onClick={() => onToolChange("annotate")} type="button">{messages.viewerAnnotationShort}</button>
      <button aria-label={messages.captureViewport} onClick={onScreenshot} type="button">{messages.viewerPngShort}</button>
    </div>
  );
}
