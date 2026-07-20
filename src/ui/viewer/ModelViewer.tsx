import {
  forwardRef,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { RenderSuccess3D } from "../../application/engine/contracts";
import type { Point3 } from "../../application/viewer/measurements";
import type {
  PointMeasurement,
  ViewerAnnotation,
  ViewerCameraState,
  ViewerFurnitureState,
} from "../../application/viewer/viewer-state";
import { messages } from "../../messages/en";
import { DEFAULT_CAMERA, DEFAULT_FURNITURE, DEFAULT_MOUSE_MAPPING, type ModelMeshParser, ParsedMeshReuse } from "./model-viewer-defaults";
import { ModelViewerOverlays, type SpatialOverlays } from "./model-viewer-overlays";
import {
  captureViewportPng,
  configureMouse,
  controlsCameraState,
  type MouseButton,
  makeCamera,
  type OverlayPosition,
  projectionOf,
  projectPoint,
  removeModel,
  thumbnailPng,
  updateProjection,
  type ViewerResources,
} from "./model-viewer-runtime";
import type { ViewerTool } from "./ViewerToolbar";
import { rebuildFurniture, type ViewerDegradation } from "./viewer-furniture";
import { applyViewerTheme, type ViewerThemeColors } from "./viewer-theme";
import { useMeshParser } from "./use-mesh-parser";
export interface ModelViewerHandle { capturePng(width?: number, height?: number): Promise<Uint8Array>; captureThumbnailPng(): Promise<Uint8Array>; }
export type { ModelMeshParser } from "./model-viewer-defaults";
export interface ModelViewerProps {
  readonly result?: RenderSuccess3D;
  readonly emptyMessage?: string;
  readonly colors: ViewerThemeColors;
  readonly camera?: ViewerCameraState;
  readonly furniture?: ViewerFurnitureState;
  readonly measurements?: readonly PointMeasurement[];
  readonly annotations?: readonly ViewerAnnotation[];
  readonly tool?: ViewerTool;
  readonly dimmed?: boolean;
  readonly meshColor?: string | null;
  readonly mouseMapping?: { readonly orbit: MouseButton; readonly pan: MouseButton };
  readonly meshParser?: ModelMeshParser;
  readonly onCameraChange?: (camera: ViewerCameraState) => void;
  readonly onPointPick?: (point: Point3) => void;
  readonly onDegradationChange?: (degradation: ViewerDegradation) => void;
  readonly onFrameRendered?: (durationMs: number) => void;
}
export const ModelViewer = forwardRef<ModelViewerHandle, ModelViewerProps>(function ModelViewer({
  result,
  emptyMessage = messages.modelAwaitingRender,
  colors,
  camera = DEFAULT_CAMERA,
  furniture = DEFAULT_FURNITURE,
  measurements = [],
  annotations = [],
  tool = "navigate",
  dimmed = false,
  meshColor = null,
  mouseMapping = DEFAULT_MOUSE_MAPPING,
  meshParser,
  onCameraChange,
  onPointPick,
  onDegradationChange,
  onFrameRendered,
}, forwardedRef) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const resources = useRef<ViewerResources | null>(null);
  const parsedMeshReuse = useRef(new ParsedMeshReuse());
  const activeMeshParser = useMeshParser(meshParser);
  const cameraRef = useRef(camera);
  const colorsRef = useRef(colors);
  const furnitureRef = useRef(furniture);
  const measurementsRef = useRef(measurements);
  const annotationsRef = useRef(annotations);
  const toolRef = useRef(tool);
  const dimmedRef = useRef(dimmed);
  const meshColorRef = useRef(meshColor);
  const mouseMappingRef = useRef(mouseMapping);
  const onCameraChangeRef = useRef(onCameraChange);
  const onPointPickRef = useRef(onPointPick);
  const onDegradationChangeRef = useRef(onDegradationChange);
  const onFrameRenderedRef = useRef(onFrameRendered);
  const [overlays, setOverlays] = useState<SpatialOverlays>({
    measurements: new Map(),
    annotations: new Map(),
  });
  const [geometryError, setGeometryError] = useState<string | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  cameraRef.current = camera;
  colorsRef.current = colors;
  furnitureRef.current = furniture;
  measurementsRef.current = measurements;
  annotationsRef.current = annotations;
  toolRef.current = tool;
  dimmedRef.current = dimmed;
  meshColorRef.current = meshColor;
  mouseMappingRef.current = mouseMapping;
  onCameraChangeRef.current = onCameraChange;
  onPointPickRef.current = onPointPick;
  onDegradationChangeRef.current = onDegradationChange;
  onFrameRenderedRef.current = onFrameRendered;
  const appearanceKey = [
    colors.background,
    colors.mesh,
    colors.edges,
    colors.grid,
    colors.gridMajor,
    colors.axisX,
    colors.axisY,
    colors.axisZ,
    furniture.grid,
    furniture.axes,
    furniture.edges,
    furniture.shadow,
    dimmed,
    meshColor,
  ].join("|");
  const overlayKey = [
    ...measurements.flatMap(({ id, start, end }) => [id, ...start, ...end]),
    ...annotations.flatMap(({ id, point, text }) => [id, ...point, text]),
  ].join("|");
  useEffect(() => {
    if (!canvas.current) return;
    if (typeof WebGLRenderingContext === "undefined") {
      setViewerError(messages.webglViewerUnavailable);
      return;
    }
    let active = true;
    const scene = new Scene();
    scene.add(new AmbientLight(undefined, 1.6));
    const keyLight = new DirectionalLight(undefined, 2.8);
    keyLight.position.set(4, 6, 8);
    scene.add(keyLight);
    let renderer: WebGLRenderer | null = null;
    try {
      renderer = new WebGLRenderer({ canvas: canvas.current, antialias: true });
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    } catch {
      renderer?.dispose();
      setViewerError(messages.webglViewerUnavailable);
      return;
    }
    setViewerError(null);
    const initialCamera = makeCamera(cameraRef.current.projection);
    const initialControls = new OrbitControls(initialCamera, canvas.current);
    const viewer: ViewerResources = {
      scene,
      renderer,
      keyLight,
      camera: initialCamera,
      controls: initialControls,
      frame: null,
      width: 1,
      height: 1,
      applyCamera: () => undefined,
      refreshAppearance: () => undefined,
      invalidate: () => undefined,
    };
    const updateOverlays = () => {
      viewer.camera.updateMatrixWorld(true);
      const measurementPositions = new Map<string, OverlayPosition>();
      for (const measurement of measurementsRef.current) {
        const midpoint = measurement.start.map(
          (value, axis) => (value + measurement.end[axis]) / 2,
        ) as [number, number, number];
        const position = projectPoint(midpoint, viewer.camera, viewer.width, viewer.height);
        if (position) measurementPositions.set(measurement.id, position);
      }
      const annotationPositions = new Map<string, OverlayPosition>();
      for (const annotation of annotationsRef.current) {
        const position = projectPoint(annotation.point, viewer.camera, viewer.width, viewer.height);
        if (position) annotationPositions.set(annotation.id, position);
      }
      if (active) setOverlays({ measurements: measurementPositions, annotations: annotationPositions });
    };
    viewer.invalidate = () => {
      if (!active || viewer.frame !== null) return;
      viewer.frame = requestAnimationFrame(() => {
        viewer.frame = null;
        const startedAt = performance.now();
        viewer.renderer.render(viewer.scene, viewer.camera);
        onFrameRenderedRef.current?.(performance.now() - startedAt);
        updateOverlays();
      });
    };
    const reportCamera = () => onCameraChangeRef.current?.(controlsCameraState(viewer));
    const bindControls = (controls: OrbitControls) => {
      controls.enableDamping = false;
      controls.enabled = toolRef.current === "navigate";
      configureMouse(controls, mouseMappingRef.current);
      controls.addEventListener("change", viewer.invalidate);
      controls.addEventListener("end", reportCamera);
    };
    const unbindControls = (controls: OrbitControls) => {
      controls.removeEventListener("change", viewer.invalidate);
      controls.removeEventListener("end", reportCamera);
    };
    bindControls(viewer.controls);
    viewer.applyCamera = (state) => {
      if (projectionOf(viewer.camera) !== state.projection) {
        unbindControls(viewer.controls);
        viewer.controls.dispose();
        viewer.camera = makeCamera(state.projection);
        viewer.controls = new OrbitControls(viewer.camera, canvas.current as HTMLCanvasElement);
        bindControls(viewer.controls);
      }
      viewer.camera.position.set(...state.position);
      viewer.camera.up.set(...state.up);
      viewer.camera.zoom = state.zoom;
      viewer.controls.target.set(...state.target);
      viewer.camera.lookAt(viewer.controls.target);
      updateProjection(viewer.camera, viewer.controls.target, viewer.width, viewer.height);
      viewer.controls.update();
      viewer.invalidate();
    };
    viewer.refreshAppearance = () => {
      const themedColors = {
        ...colorsRef.current,
        mesh: meshColorRef.current ?? colorsRef.current.mesh,
      };
      applyViewerTheme(viewer, themedColors);
      if (viewer.mesh) {
        viewer.mesh.material.transparent = dimmedRef.current;
        viewer.mesh.material.opacity = dimmedRef.current ? 0.35 : 1;
        viewer.mesh.material.depthWrite = !dimmedRef.current;
      }
      const rebuilt = rebuildFurniture({
        scene: viewer.scene,
        renderer: viewer.renderer,
        keyLight: viewer.keyLight,
        mesh: viewer.mesh,
        geometry: viewer.parsed,
        furniture: furnitureRef.current,
        colors: themedColors,
        previous: viewer.furniture,
      });
      viewer.furniture = rebuilt.resources;
      onDegradationChangeRef.current?.(rebuilt.degradation);
      viewer.invalidate();
    };
    const resize = () => {
      const element = canvas.current;
      if (!element) return;
      viewer.width = Math.max(element.clientWidth, 1);
      viewer.height = Math.max(element.clientHeight, 1);
      viewer.renderer.setSize(viewer.width, viewer.height, false);
      updateProjection(viewer.camera, viewer.controls.target, viewer.width, viewer.height);
      viewer.invalidate();
    };
    resources.current = viewer;
    viewer.applyCamera(cameraRef.current);
    resize();
    let resizeFrame: number | null = null;
    const requestResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        resize();
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestResize);
    observer?.observe(canvas.current.parentElement ?? canvas.current);
    return () => {
      active = false;
      observer?.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (viewer.frame !== null) cancelAnimationFrame(viewer.frame);
      unbindControls(viewer.controls);
      removeModel(viewer);
      viewer.controls.dispose();
      viewer.renderer.dispose();
      if (resources.current === viewer) resources.current = null;
    };
  }, []);
  useEffect(() => resources.current?.applyCamera(camera), [camera]);
  useEffect(() => {
    const viewer = resources.current;
    if (!viewer) return;
    let active = true;
    setGeometryError(null);
    if (!result) {
      removeModel(viewer);
      viewer.refreshAppearance();
      return;
    }
    if (viewer.parsed && parsedMeshReuse.current.matches(result, activeMeshParser)) return;
    const parser = new AbortController();
    void activeMeshParser(result.mesh.bytes, parser.signal).then((parsed) => {
      if (!active || resources.current !== viewer) return;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(parsed.positions, 3));
      geometry.setAttribute("normal", new BufferAttribute(parsed.normals, 3));
      const material = new MeshStandardMaterial({ roughness: 0.72, metalness: 0.08 });
      const mesh = new Mesh(geometry, material);
      removeModel(viewer);
      viewer.mesh = mesh;
      viewer.parsed = parsed;
      parsedMeshReuse.current.accept(result, activeMeshParser);
      viewer.scene.add(mesh);
      viewer.refreshAppearance();
    }, () => {
      if (!active || resources.current !== viewer) return;
      setGeometryError(messages.renderedMeshDisplayFailed);
    });
    return () => { active = false; parser.abort(); };
  }, [activeMeshParser, result]);
  useEffect(() => {
    if (appearanceKey.length > 0) resources.current?.refreshAppearance();
  }, [appearanceKey]);
  useEffect(() => {
    const viewer = resources.current;
    if (!viewer) return;
    viewer.controls.enabled = tool === "navigate";
    configureMouse(viewer.controls, mouseMapping);
    viewer.invalidate();
  }, [mouseMapping, tool]);
  useEffect(() => {
    if (overlayKey === "") {
      setOverlays({ measurements: new Map(), annotations: new Map() });
      return;
    }
    resources.current?.invalidate();
  }, [overlayKey]);
  useImperativeHandle(forwardedRef, () => ({
    async capturePng(width, height) {
      const viewer = resources.current;
      const element = canvas.current;
      if (!viewer || !element) throw new Error(messages.modelViewportUnavailable);
      return captureViewportPng(viewer, element, width, height);
    },
    async captureThumbnailPng() {
      const viewer = resources.current;
      const element = canvas.current;
      if (!viewer || !element) throw new Error(messages.modelViewportUnavailable);
      return thumbnailPng(viewer, element);
    },
  }), []);
  const pickPoint = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const viewer = resources.current;
    if (!viewer?.mesh || toolRef.current === "navigate") return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const pointer = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    viewer.scene.updateMatrixWorld(true);
    viewer.camera.updateMatrixWorld(true);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(pointer, viewer.camera);
    const hit = raycaster.intersectObject(viewer.mesh, false)[0];
    if (hit) onPointPickRef.current?.(hit.point.toArray());
  };
  const displayError = viewerError ?? geometryError;
  return (
    <div className={`model-viewer${dimmed ? " model-viewer-dimmed" : ""}`}>
      <canvas
        aria-hidden={viewerError ? true : undefined}
        aria-label={messages.viewerRegion}
        data-viewer-tool={tool}
        onClick={pickPoint}
        ref={canvas}
        tabIndex={viewerError ? -1 : 0}
      />
      {!result && !displayError && <p className="viewer-empty">{emptyMessage}</p>}
      {displayError && <p className="viewer-empty" role="alert">{displayError}</p>}
      <ModelViewerOverlays
        annotationColor={colors.annotation}
        annotations={annotations}
        measurementColor={colors.measurement}
        measurements={measurements}
        positions={overlays}
      />
    </div>
  );
});
