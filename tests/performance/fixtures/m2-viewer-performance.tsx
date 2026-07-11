import { createRoot } from "react-dom/client";
import { useState } from "react";

import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import type { ParsedBinaryStl } from "../../../src/application/geometry/stl";
import type { ViewerDegradation } from "../../../src/ui/viewer/viewer-furniture";
import type { ViewerCameraState } from "../../../src/application/viewer/viewer-state";
import { ModelViewer } from "../../../src/ui/viewer/ModelViewer";

const requestedTriangleCount = Number(new URL(location.href).searchParams.get("triangles") ?? "2000000");
if (!Number.isSafeInteger(requestedTriangleCount) || requestedTriangleCount <= 0) {
  throw new Error("The viewer profile triangle count must be a positive integer.");
}
const TRIANGLE_COUNT = requestedTriangleCount;

export interface ViewerPerformanceProfile {
  readonly averageFps: number;
  readonly degradation: ViewerDegradation;
  readonly durationMs: number;
  readonly frames: number;
  readonly hardwareConcurrency: number;
  readonly longTaskCount: number;
  readonly longestFrameMs: number;
  readonly longestLongTaskMs: number;
  readonly p95FrameMs: number;
  readonly p95RenderMs: number;
  readonly renderedFps: number;
  readonly renderedFrames: number;
  readonly longestRenderMs: number;
  readonly renderer: string;
  readonly triangleCount: number;
  readonly userAgent: string;
  readonly vendor: string;
}

declare global {
  interface Window {
    runScadMillViewerProfile(): Promise<ViewerPerformanceProfile>;
    scadmillViewerProfile?: Promise<ViewerPerformanceProfile>;
    scadmillViewerProfileStatus(): string;
  }
}

let ready!: (degradation: ViewerDegradation) => void;
const viewerReady = new Promise<ViewerDegradation>((resolve) => { ready = resolve; });
let status = "starting";
window.scadmillViewerProfileStatus = () => status;
const renderDurations: number[] = [];
let samplingRenders = false;
let driveCamera: ((angle: number) => void) | undefined;

async function generatedGeometry(_bytes: Uint8Array, signal: AbortSignal): Promise<ParsedBinaryStl> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  status = "building-geometry";
  const positions = new Float32Array(TRIANGLE_COUNT * 9);
  const normals = new Float32Array(TRIANGLE_COUNT * 9);
  for (let triangle = 0; triangle < TRIANGLE_COUNT; triangle += 1) {
    if (triangle % 100_000 === 0 && signal.aborted) {
      const error = new Error("Viewer profile geometry generation was aborted.");
      error.name = "AbortError";
      throw error;
    }
    const offset = triangle * 9;
    const x = triangle % 2_000;
    const y = Math.floor(triangle / 2_000);
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 3] = x + 0.8;
    positions[offset + 4] = y;
    positions[offset + 6] = x;
    positions[offset + 7] = y + 0.8;
    normals[offset + 2] = 1;
    normals[offset + 5] = 1;
    normals[offset + 8] = 1;
  }
  return {
    triangleCount: TRIANGLE_COUNT,
    positions,
    normals,
    bounds: {
      min: [0, 0, 0],
      max: [1_999.8, Math.ceil(TRIANGLE_COUNT / 2_000) - 0.2, 0],
      size: [1_999.8, Math.ceil(TRIANGLE_COUNT / 2_000) - 0.2, 0],
    },
  };
}

const RESULT: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(), geometryIdentity: "m2-two-million" },
  stats: {
    triangles: TRIANGLE_COUNT,
    vertices: TRIANGLE_COUNT * 3,
    boundingBox: {
      min: [0, 0, 0],
      max: [1_999.8, Math.ceil(TRIANGLE_COUNT / 2_000) - 0.2, 0],
    },
    engineTimeMs: 0,
  },
  diagnostics: [],
  rawLog: "",
};

function Fixture() {
  const [camera, setCamera] = useState<ViewerCameraState>({
    projection: "perspective",
    position: [1_800, 1_300, 1_500],
    target: [1_000, 500, 0],
    up: [0, 0, 1],
    zoom: 1,
  });
  driveCamera = (angle) => setCamera({
    ...camera,
    position: [
      1_000 + Math.cos(angle) * 1_500,
      500 + Math.sin(angle) * 1_500,
      1_200,
    ],
  });
  return (
    <ModelViewer
      camera={camera}
      colors={{
        background: "#101820",
        mesh: "#d8e5ee",
        edges: "#ffffff",
        grid: "#334455",
        gridMajor: "#556677",
        axisX: "#ff3333",
        axisY: "#33ff33",
        axisZ: "#3388ff",
        measurement: "#ffffff",
        annotation: "#ffffff",
      }}
      furniture={{ grid: false, axes: false, edges: true, shadow: true }}
      meshParser={generatedGeometry}
      onDegradationChange={(degradation) => {
        const expected = TRIANGLE_COUNT > 500_000;
        if (degradation.edges === expected && degradation.shadow === expected) {
          status = "ready";
          ready(degradation);
        }
      }}
      onFrameRendered={(durationMs) => {
        if (samplingRenders) renderDurations.push(durationMs);
      }}
      result={RESULT}
    />
  );
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

window.runScadMillViewerProfile = async () => {
  const degradation = await viewerReady;
  const canvas = document.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("The model canvas is missing.");
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!gl) throw new Error("The viewer did not retain a WebGL context.");
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug
    ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  const vendor = debug
    ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))
    : String(gl.getParameter(gl.VENDOR));

  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  });
  observer.observe({ type: "longtask", buffered: false });
  renderDurations.length = 0;
  samplingRenders = true;

  const intervals: number[] = [];
  const startedAt = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
  let previous = startedAt;
  let frames = 0;
  const durationMs = await new Promise<number>((resolve) => {
    const sample = (now: number) => {
      intervals.push(now - previous);
      previous = now;
      frames += 1;
      const elapsed = now - startedAt;
      driveCamera?.(elapsed / 750);
      if (elapsed < 3_000) requestAnimationFrame(sample);
      else resolve(elapsed);
    };
    requestAnimationFrame(sample);
  });
  samplingRenders = false;
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 100));
  observer.disconnect();

  return {
    averageFps: frames / (durationMs / 1_000),
    degradation,
    durationMs,
    frames,
    hardwareConcurrency: navigator.hardwareConcurrency,
    longTaskCount: longTasks.length,
    longestFrameMs: Math.max(0, ...intervals),
    longestLongTaskMs: Math.max(0, ...longTasks),
    p95FrameMs: percentile(intervals, 0.95),
    p95RenderMs: percentile(renderDurations, 0.95),
    renderedFps: renderDurations.length / (durationMs / 1_000),
    renderedFrames: renderDurations.length,
    longestRenderMs: Math.max(0, ...renderDurations),
    renderer,
    triangleCount: TRIANGLE_COUNT,
    userAgent: navigator.userAgent,
    vendor,
  };
};

globalThis.setTimeout(() => {
  createRoot(document.getElementById("root") as HTMLElement).render(<Fixture />);
}, 0);
