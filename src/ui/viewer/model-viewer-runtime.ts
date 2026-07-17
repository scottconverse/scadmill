import {
  type BufferGeometry,
  type DirectionalLight,
  type Mesh,
  type MeshStandardMaterial,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  type Scene,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { ParsedBinaryStl } from "../../application/geometry/stl";
import type { Point3 } from "../../application/viewer/measurements";
import type { ViewerCameraState } from "../../application/viewer/viewer-state";
import { clearFurniture, type FurnitureResources } from "./viewer-furniture";

export type ViewerCamera = PerspectiveCamera | OrthographicCamera;
export type MouseButton = "left" | "middle" | "right";

export interface OverlayPosition {
  readonly left: number;
  readonly top: number;
}

export interface ViewerResources {
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  readonly keyLight: DirectionalLight;
  camera: ViewerCamera;
  controls: OrbitControls;
  mesh?: Mesh<BufferGeometry, MeshStandardMaterial>;
  parsed?: ParsedBinaryStl;
  furniture?: FurnitureResources;
  frame: number | null;
  width: number;
  height: number;
  applyCamera(camera: ViewerCameraState): void;
  refreshAppearance(): void;
  invalidate(): void;
}

export function projectionOf(camera: ViewerCamera): ViewerCameraState["projection"] {
  return camera instanceof OrthographicCamera ? "orthographic" : "perspective";
}

export function makeCamera(projection: ViewerCameraState["projection"]): ViewerCamera {
  return projection === "orthographic"
    ? new OrthographicCamera(-1, 1, 1, -1, 0.1, 10_000)
    : new PerspectiveCamera(45, 1, 0.1, 10_000);
}

export function updateProjection(
  camera: ViewerCamera,
  target: Vector3,
  width: number,
  height: number,
): void {
  const distance = Math.max(camera.position.distanceTo(target), 1);
  camera.near = Math.max(distance / 1_000, 0.01);
  camera.far = Math.max(distance * 100, 1_000);
  if (camera instanceof PerspectiveCamera) {
    camera.aspect = width / height;
  } else {
    const halfHeight = Math.max(distance / 2.2, 1);
    const halfWidth = halfHeight * width / height;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
  }
  camera.updateProjectionMatrix();
}

export function controlsCameraState(resources: ViewerResources): ViewerCameraState {
  return {
    projection: projectionOf(resources.camera),
    position: resources.camera.position.toArray(),
    target: resources.controls.target.toArray(),
    up: resources.camera.up.toArray(),
    zoom: resources.camera.zoom,
  };
}

function mouseAction(button: MouseButton, orbit: MouseButton, pan: MouseButton) {
  if (button === orbit) return MOUSE.ROTATE;
  if (button === pan) return MOUSE.PAN;
  return MOUSE.DOLLY;
}

export function configureMouse(
  controls: OrbitControls,
  mapping: { readonly orbit: MouseButton; readonly pan: MouseButton },
): void {
  controls.mouseButtons.LEFT = mouseAction("left", mapping.orbit, mapping.pan);
  controls.mouseButtons.MIDDLE = mouseAction("middle", mapping.orbit, mapping.pan);
  controls.mouseButtons.RIGHT = mouseAction("right", mapping.orbit, mapping.pan);
}

export function removeModel(resources: ViewerResources): void {
  clearFurniture(resources.scene, resources.furniture);
  resources.furniture = undefined;
  if (!resources.mesh) return;
  resources.scene.remove(resources.mesh);
  resources.mesh.geometry.dispose();
  resources.mesh.material.dispose();
  resources.mesh = undefined;
  resources.parsed = undefined;
}

export function projectPoint(
  point: Point3,
  camera: ViewerCamera,
  width: number,
  height: number,
): OverlayPosition | null {
  const projected = new Vector3(...point).project(camera);
  if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) {
    return null;
  }
  return {
    left: (projected.x + 1) * width / 2,
    top: (1 - projected.y) * height / 2,
  };
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("The viewport could not be encoded as PNG."));
          return;
        }
        void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
      }, "image/png");
    });
  }
  const encoded = canvas.toDataURL("image/png").split(",", 2)[1];
  if (!encoded) return Promise.reject(new Error("The viewport could not be encoded as PNG."));
  const binary = globalThis.atob(encoded);
  return Promise.resolve(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export async function thumbnailPng(
  viewer: ViewerResources,
  canvas: HTMLCanvasElement,
): Promise<Uint8Array> {
  viewer.renderer.render(viewer.scene, viewer.camera);
  const previousWidth = viewer.width;
  const previousHeight = viewer.height;
  viewer.renderer.setSize(240, 160, false);
  const bytes = await canvasPng(canvas);
  viewer.renderer.setSize(previousWidth, previousHeight, false);
  return bytes;
}
