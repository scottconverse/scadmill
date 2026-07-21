import {
  BufferGeometry,
  type DirectionalLight,
  Float32BufferAttribute,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  type Scene,
  ShadowMaterial,
  type WebGLRenderer,
  EdgesGeometry,
} from "three";

import type { ParsedBinaryStl } from "../../application/geometry/stl";
import type { ViewerFurnitureState } from "../../application/viewer/viewer-state";
import type { ViewerThemeColors } from "./viewer-theme";

export const LARGE_MESH_FURNITURE_LIMIT = 500_000;

export interface ViewerDegradation {
  readonly edges: boolean;
  readonly shadow: boolean;
}

export interface FurnitureResources {
  readonly objects: readonly (GridHelper | Group | LineSegments | Mesh)[];
}

function disposeObject(object: GridHelper | Group | LineSegments | Mesh): void {
  object.traverse((child) => {
    const disposable = child as typeof child & {
      geometry?: { dispose(): void };
      material?: { dispose(): void } | readonly { dispose(): void }[];
    };
    disposable.geometry?.dispose();
    const materials = disposable.material === undefined
      ? []
      : Array.isArray(disposable.material)
        ? disposable.material
        : [disposable.material];
    for (const material of materials) material.dispose();
  });
}

export function clearFurniture(scene: Scene, resources?: FurnitureResources): void {
  if (!resources) return;
  for (const object of resources.objects) {
    scene.remove(object);
    disposeObject(object);
  }
}

function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / exponent;
  const rounded = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return rounded * exponent;
}

function axisLine(to: readonly [number, number, number], color: string): Line {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, ...to], 3));
  return new Line(geometry, new LineBasicMaterial({ color }));
}

function createAxes(length: number, colors: ViewerThemeColors): Group {
  const axes = new Group();
  axes.add(axisLine([length, 0, 0], colors.axisX ?? colors.mesh));
  axes.add(axisLine([0, length, 0], colors.axisY ?? colors.mesh));
  axes.add(axisLine([0, 0, length], colors.axisZ ?? colors.mesh));
  return axes;
}

export function rebuildFurniture(options: {
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  readonly keyLight: DirectionalLight;
  readonly mesh?: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly geometry?: ParsedBinaryStl;
  readonly furniture: ViewerFurnitureState;
  readonly colors: ViewerThemeColors;
  readonly previous?: FurnitureResources;
}): { readonly resources: FurnitureResources; readonly degradation: ViewerDegradation } {
  const { scene, renderer, keyLight, mesh, geometry, furniture, colors, previous } = options;
  clearFurniture(scene, previous);
  const objects: (GridHelper | Group | LineSegments | Mesh)[] = [];
  const triangleCount = geometry?.triangleCount ?? 0;
  const large = triangleCount > LARGE_MESH_FURNITURE_LIMIT;
  const degradation = {
    edges: furniture.edges && large,
    shadow: furniture.shadow && large,
  };
  const maximumExtent = Math.max(...(geometry?.bounds.size ?? [10, 10, 10]), 1);

  if (furniture.grid) {
    const step = niceStep(maximumExtent / 10);
    const grid = new GridHelper(
      step * 20,
      20,
      colors.gridMajor ?? colors.mesh,
      colors.grid ?? colors.mesh,
    );
    grid.rotation.x = Math.PI / 2;
    objects.push(grid);
    scene.add(grid);
  }
  if (furniture.axes) {
    const axes = createAxes(Math.max(maximumExtent * 0.6, 5), colors);
    objects.push(axes);
    scene.add(axes);
  }
  if (mesh && furniture.edges && !degradation.edges) {
    const edges = new LineSegments(
      new EdgesGeometry(mesh.geometry),
      new LineBasicMaterial({ color: colors.edges ?? colors.mesh }),
    );
    objects.push(edges);
    scene.add(edges);
  }

  const shadowEnabled = Boolean(mesh && furniture.shadow && !degradation.shadow);
  renderer.shadowMap.enabled = shadowEnabled;
  keyLight.castShadow = shadowEnabled;
  if (mesh) mesh.castShadow = shadowEnabled;
  if (mesh && geometry && shadowEnabled) {
    const plane = new Mesh(
      new PlaneGeometry(maximumExtent * 4, maximumExtent * 4),
      new ShadowMaterial({ opacity: 0.2 }),
    );
    plane.position.z = geometry.bounds.min[2] - Math.max(maximumExtent * 0.002, 0.001);
    plane.receiveShadow = true;
    objects.push(plane);
    scene.add(plane);
  }

  return { resources: { objects }, degradation };
}
