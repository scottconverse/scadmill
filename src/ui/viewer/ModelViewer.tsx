import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { RenderSuccess3D } from "../../application/engine/contracts";
import { parseBinaryStl } from "../../application/geometry/stl";
import { messages } from "../../messages/en";

export interface ModelViewerProps {
  result?: RenderSuccess3D;
}

interface ViewerResources {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  mesh?: Mesh<BufferGeometry, MeshStandardMaterial>;
  animationFrame: number;
  hasFit: boolean;
}

export function ModelViewer({ result }: ModelViewerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const resources = useRef<ViewerResources | null>(null);

  useEffect(() => {
    if (!canvas.current || typeof WebGLRenderingContext === "undefined") {
      return;
    }
    const styles = getComputedStyle(canvas.current);
    const scene = new Scene();
    scene.background = new Color(styles.getPropertyValue("--viewer-background").trim());
    scene.add(new AmbientLight(styles.getPropertyValue("--viewer-light").trim(), 1.6));
    const keyLight = new DirectionalLight(styles.getPropertyValue("--viewer-light").trim(), 2.8);
    keyLight.position.set(4, 6, 8);
    scene.add(keyLight);

    const camera = new PerspectiveCamera(45, 1, 0.1, 10_000);
    camera.position.set(28, 24, 28);
    const renderer = new WebGLRenderer({ canvas: canvas.current, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const controls = new OrbitControls(camera, canvas.current);
    controls.enableDamping = true;

    const resize = () => {
      if (!canvas.current) return;
      const width = Math.max(canvas.current.clientWidth, 1);
      const height = Math.max(canvas.current.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(canvas.current);

    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
      if (resources.current) {
        resources.current.animationFrame = requestAnimationFrame(renderFrame);
      }
    };
    resources.current = { scene, camera, renderer, controls, animationFrame: 0, hasFit: false };
    resources.current.animationFrame = requestAnimationFrame(renderFrame);

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(resources.current?.animationFrame ?? 0);
      resources.current?.mesh?.geometry.dispose();
      resources.current?.mesh?.material.dispose();
      controls.dispose();
      renderer.dispose();
      resources.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = resources.current;
    if (!viewer || !result || !canvas.current) {
      return;
    }
    const parsed = parseBinaryStl(result.mesh.bytes);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(parsed.positions, 3));
    geometry.computeVertexNormals();
    const styles = getComputedStyle(canvas.current);
    const material = new MeshStandardMaterial({
      color: new Color(styles.getPropertyValue("--viewer-mesh").trim()),
      roughness: 0.72,
      metalness: 0.08,
    });
    const mesh = new Mesh(geometry, material);

    if (viewer.mesh) {
      viewer.scene.remove(viewer.mesh);
      viewer.mesh.geometry.dispose();
      viewer.mesh.material.dispose();
    }
    viewer.mesh = mesh;
    viewer.scene.add(mesh);

    if (!viewer.hasFit) {
      const center = parsed.bounds.min.map(
        (minimum, axis) => (minimum + parsed.bounds.max[axis]) / 2,
      ) as [number, number, number];
      const distance = Math.max(...parsed.bounds.size) * 2.2 || 20;
      viewer.controls.target.set(...center);
      viewer.camera.position.set(center[0] + distance, center[1] + distance * 0.75, center[2] + distance);
      viewer.camera.near = Math.max(distance / 1_000, 0.01);
      viewer.camera.far = distance * 100;
      viewer.camera.updateProjectionMatrix();
      viewer.controls.update();
      viewer.hasFit = true;
    }
  }, [result]);

  return (
    <div className="model-viewer">
      <canvas ref={canvas} aria-label={messages.viewerRegion} />
      {!result && <p className="viewer-empty">{messages.modelAwaitingRender}</p>}
    </div>
  );
}
