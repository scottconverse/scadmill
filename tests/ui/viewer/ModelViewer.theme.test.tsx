// @vitest-environment happy-dom
import { createRef } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import {
  AmbientLight,
  BufferGeometry,
  type Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  type Scene,
  Vector3,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import type { ParsedBinaryStl } from "../../../src/application/geometry/stl";
import {
  ModelViewer,
  type ModelViewerHandle,
} from "../../../src/ui/viewer/ModelViewer";

interface RendererRecord {
  readonly render: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
}

interface ControlsRecord {
  readonly object: PerspectiveCamera;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly target: Vector3;
  readonly listeners: Map<string, Set<() => void>>;
}

const threeHarness = vi.hoisted(() => ({
  scenes: [] as Scene[],
  renderers: [] as RendererRecord[],
  controls: [] as ControlsRecord[],
  rendererError: null as Error | null,
}));

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();

  class TestScene extends actual.Scene {
    constructor() {
      super();
      threeHarness.scenes.push(this);
    }
  }

  class TestWebGLRenderer {
    readonly render = vi.fn();
    readonly dispose = vi.fn();
    readonly setPixelRatio = vi.fn();
    readonly setSize = vi.fn();
    readonly shadowMap = { enabled: false };

    constructor() {
      if (threeHarness.rendererError) throw threeHarness.rendererError;
      threeHarness.renderers.push(this);
    }
  }

  return { ...actual, Scene: TestScene, WebGLRenderer: TestWebGLRenderer };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class TestOrbitControls {
    readonly target = new Vector3();
    readonly update = vi.fn();
    readonly dispose = vi.fn();
    readonly listeners = new Map<string, Set<() => void>>();
    readonly mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 };
    enableDamping = false;
    enabled = true;

    constructor(
      readonly object: PerspectiveCamera,
      _canvas: HTMLCanvasElement,
    ) {
      threeHarness.controls.push(this);
    }

    addEventListener(type: string, listener: () => void) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: () => void) {
      this.listeners.get(type)?.delete(listener);
    }
  },
}));

const darkColors = { background: "#101827", mesh: "#F4B942" };
const lightColors = { background: "#E4EBF2", mesh: "#B56A00" };

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`The test viewer did not create ${label}.`);
  }
  return value;
}

function modelMesh(scene: Scene): Mesh<BufferGeometry, MeshStandardMaterial> {
  const mesh = required(
    scene.children.find((child) => child instanceof Mesh),
    "a model mesh",
  );
  if (!(mesh.geometry instanceof BufferGeometry) || !(mesh.material instanceof MeshStandardMaterial)) {
    throw new Error("The test viewer created an unexpected model mesh type.");
  }
  return mesh as Mesh<BufferGeometry, MeshStandardMaterial>;
}

function oneTriangleResult(): RenderSuccess3D {
  const bytes = new Uint8Array(134);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  [0, 0, 0, 10, 0, 0, 10, 10, 10].forEach((coordinate, index) => {
    view.setFloat32(96 + index * 4, coordinate, true);
  });

  return {
    kind: "3d",
    mesh: { format: "stl-binary", bytes },
    stats: {
      triangles: 1,
      boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
      engineTimeMs: 1,
    },
    diagnostics: [],
    rawLog: "rendered",
  };
}

describe("ModelViewer theme", () => {
  beforeEach(() => {
    threeHarness.scenes.length = 0;
    threeHarness.renderers.length = 0;
    threeHarness.controls.length = 0;
    threeHarness.rendererError = null;
    vi.stubGlobal("WebGLRenderingContext", class WebGLRenderingContext {});
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn(
        () =>
          ({
            getPropertyValue: (property: string) => {
              if (property === "--viewer-background") return darkColors.background;
              if (property === "--viewer-mesh") return darkColors.mesh;
              if (property === "--viewer-light") return "#FFFFFF";
              return "";
            },
          }) as CSSStyleDeclaration,
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes the viewport keyboard-focusable for scoped viewer commands", () => {
    const view = render(<ModelViewer colors={darkColors} />);

    expect(view.container.querySelector("canvas")).toHaveAttribute("tabindex", "0");
  });

  it("shows an accessible fallback when WebGL is unavailable for a rendered model", async () => {
    vi.stubGlobal("WebGLRenderingContext", undefined);

    const view = render(<ModelViewer colors={darkColors} result={oneTriangleResult()} />);

    expect(await view.findByRole("alert")).toHaveTextContent(
      "3D model display is unavailable because WebGL could not start. Editing and exports remain available.",
    );
    expect(view.container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    expect(view.container.querySelector("canvas")).toHaveAttribute("tabindex", "-1");
  });

  it("shows the WebGL fallback instead of crashing when renderer creation fails", async () => {
    threeHarness.rendererError = new Error("context creation failed");

    const view = render(<ModelViewer colors={darkColors} result={oneTriangleResult()} />);

    expect(await view.findByRole("alert")).toHaveTextContent(
      "3D model display is unavailable because WebGL could not start. Editing and exports remain available.",
    );
  });

  it("observes the stable viewport wrapper instead of the canvas it resizes", () => {
    const observed: Element[] = [];
    vi.stubGlobal("ResizeObserver", class ResizeObserver {
      observe(target: Element) { observed.push(target); }
      disconnect() {}
    });

    const view = render(<ModelViewer colors={darkColors} />);

    expect(observed).toEqual([view.container.querySelector(".model-viewer")]);
  });

  it("accepts a pre-parsed geometry seam for isolated production-render profiling", async () => {
    const parsed: ParsedBinaryStl = {
      triangleCount: 1,
      positions: new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 10]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      bounds: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
    };
    const meshParser = vi.fn(async () => parsed);
    const result = oneTriangleResult();

    render(<ModelViewer colors={darkColors} meshParser={meshParser} result={result} />);

    await waitFor(() => expect(modelMesh(threeHarness.scenes[0])).toBeInstanceOf(Mesh));
    expect(meshParser).toHaveBeenCalledWith(result.mesh.bytes, expect.any(AbortSignal));
  });

  it("hot-applies viewer colors without reconstructing Three resources", async () => {
    const result = oneTriangleResult();
    const view = render(<ModelViewer result={result} colors={darkColors} />);
    const scene = threeHarness.scenes[0];
    const renderer = threeHarness.renderers[0];
    const controls = threeHarness.controls[0];
    const camera = controls.object;
    const mesh = await waitFor(() => modelMesh(scene));

    expect((scene.background as Color).getHexString()).toBe("101827");
    expect(mesh.material.color.getHexString()).toBe("f4b942");

    const geometry = mesh.geometry;
    const material = mesh.material;
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");

    view.rerender(<ModelViewer result={result} colors={lightColors} />);

    expect((scene.background as Color).getHexString()).toBe("e4ebf2");
    expect(mesh.material.color.getHexString()).toBe("b56a00");
    expect(threeHarness.scenes).toEqual([scene]);
    expect(threeHarness.renderers).toEqual([renderer]);
    expect(threeHarness.controls).toEqual([controls]);
    expect(threeHarness.controls[0].object).toBe(camera);
    expect(scene.children.find((child) => child instanceof Mesh)).toBe(mesh);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.material).toBe(material);
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
  });

  it("keeps the last mesh visible until a replacement worker succeeds", async () => {
    const view = render(<ModelViewer result={oneTriangleResult()} colors={darkColors} />);
    const scene = threeHarness.scenes[0];
    const previous = await waitFor(() => modelMesh(scene));
    const disposeGeometry = vi.spyOn(previous.geometry, "dispose");
    const disposeMaterial = vi.spyOn(previous.material, "dispose");
    const workers: {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
    }[] = [];
    class ControlledParserWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly postMessage = vi.fn();
      readonly terminate = vi.fn();
      constructor() { workers.push(this); }
    }
    vi.stubGlobal("Worker", ControlledParserWorker);
    const replacement = oneTriangleResult();
    replacement.mesh.bytes[100] = 5;

    view.rerender(<ModelViewer result={replacement} colors={darkColors} />);

    expect(modelMesh(scene)).toBe(previous);
    expect(disposeGeometry).not.toHaveBeenCalled();
    const worker = required(workers[0], "a replacement parser worker");
    worker.onmessage?.({
      data: {
        ok: true,
        triangleCount: 1,
        positions: new Float32Array(9).buffer,
        normals: new Float32Array(9).buffer,
        bounds: { min: [0, 0, 0], max: [2, 2, 2], size: [2, 2, 2] },
      },
    } as MessageEvent);

    await waitFor(() => expect(modelMesh(scene)).not.toBe(previous));
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
  });

  it("keeps the last mesh visible when replacement parsing fails", async () => {
    const view = render(<ModelViewer result={oneTriangleResult()} colors={darkColors} />);
    const scene = threeHarness.scenes[0];
    const previous = await waitFor(() => modelMesh(scene));
    const disposeGeometry = vi.spyOn(previous.geometry, "dispose");
    const workers: {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
    }[] = [];
    class ControlledParserWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly postMessage = vi.fn();
      readonly terminate = vi.fn();
      constructor() { workers.push(this); }
    }
    vi.stubGlobal("Worker", ControlledParserWorker);
    const replacement = oneTriangleResult();
    replacement.mesh.bytes[100] = 7;

    view.rerender(<ModelViewer result={replacement} colors={darkColors} />);
    const worker = required(workers[0], "a replacement parser worker");
    worker.onerror?.({ message: "replacement parse failed" } as ErrorEvent);

    expect(await view.findByRole("alert")).toHaveTextContent("replacement parse failed");
    expect(modelMesh(scene)).toBe(previous);
    expect(disposeGeometry).not.toHaveBeenCalled();
  });

  it("keeps viewer illumination neutral instead of sourcing it from the theme", () => {
    vi.stubGlobal(
      "getComputedStyle",
      vi.fn(
        () =>
          ({
            getPropertyValue: (property: string) =>
              property === "--viewer-light" ? "#123456" : "",
          }) as CSSStyleDeclaration,
      ),
    );

    render(<ModelViewer colors={darkColors} />);

    const scene = threeHarness.scenes[0];
    const ambient = required(
      scene.children.find((child): child is AmbientLight => child instanceof AmbientLight),
      "an ambient light",
    );
    const directional = required(
      scene.children.find((child): child is DirectionalLight => child instanceof DirectionalLight),
      "a directional light",
    );
    expect(ambient.color.getHexString()).toBe("ffffff");
    expect(directional.color.getHexString()).toBe("ffffff");
  });

  it("renders on demand instead of scheduling an endless animation loop", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));

    render(<ModelViewer colors={darkColors} />);

    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    expect(frames).toHaveLength(0);
  });

  it("applies a controlled per-document camera without refitting it on a new mesh", () => {
    const camera = {
      projection: "perspective" as const,
      position: [17.25, -9.5, 42] as const,
      target: [2, 3, 4] as const,
      up: [0, 0, 1] as const,
      zoom: 1.4,
    };

    render(<ModelViewer camera={camera} colors={darkColors} result={oneTriangleResult()} />);

    const controls = required(threeHarness.controls[0], "orbit controls");
    expect(controls.object.position.toArray()).toEqual(camera.position);
    expect(controls.target.toArray()).toEqual(camera.target);
    expect(controls.object.zoom).toBe(camera.zoom);
  });

  it("picks a model point for point-to-point measurement mode", async () => {
    const picked = vi.fn();
    const result = oneTriangleResult();
    const camera = {
      projection: "perspective" as const,
      position: [5, 5, 30] as const,
      target: [5, 5, 0] as const,
      up: [0, 1, 0] as const,
      zoom: 1,
    };
    const view = render(
      <ModelViewer
        camera={camera}
        colors={darkColors}
        onPointPick={picked}
        result={result}
        tool="measure"
      />,
    );
    const canvas = view.container.querySelector("canvas");
    if (!canvas) throw new Error("Model canvas did not mount.");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    await waitFor(() => expect(modelMesh(threeHarness.scenes[0])).toBeDefined());

    fireEvent.click(canvas, { clientX: 50, clientY: 50 });

    expect(picked).toHaveBeenCalledTimes(1);
    expect(picked.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]));
  });

  it("captures a decodable PNG byte payload from the current canvas scene", async () => {
    const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob([pngSignature], { type: "image/png" }));
    });
    vi.stubGlobal("HTMLCanvasElement", globalThis.HTMLCanvasElement);
    Object.defineProperty(globalThis.HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: toBlob,
    });
    const ref = createRef<ModelViewerHandle>();
    render(<ModelViewer colors={darkColors} ref={ref} result={oneTriangleResult()} />);

    const bytes = await ref.current?.capturePng();

    expect(bytes?.slice(0, 8)).toEqual(pngSignature);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });

  it("transfers STL decoding to a worker when the host supports workers", () => {
    const workers: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[] = [];
    class ParserWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly postMessage = vi.fn();
      readonly terminate = vi.fn();

      constructor() {
        workers.push(this);
      }
    }
    vi.stubGlobal("Worker", ParserWorker);

    render(<ModelViewer colors={darkColors} result={oneTriangleResult()} />);

    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: expect.any(ArrayBuffer) }),
      [expect.any(ArrayBuffer)],
    );
  });

  it("shows a parser fallback when the STL worker cannot be constructed", async () => {
    class UnavailableParserWorker {
      constructor() {
        throw new Error("worker construction failed");
      }
    }
    vi.stubGlobal("Worker", UnavailableParserWorker);

    const view = render(<ModelViewer colors={darkColors} result={oneTriangleResult()} />);

    expect(await view.findByRole("alert")).toHaveTextContent(
      "The STL parser worker could not start.",
    );
  });

  it("terminates a superseded STL parser before starting the replacement parse", () => {
    const workers: { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn> }[] = [];
    class ParserWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly postMessage = vi.fn();
      readonly terminate = vi.fn();

      constructor() {
        workers.push(this);
      }
    }
    vi.stubGlobal("Worker", ParserWorker);
    const first = oneTriangleResult();
    const second = oneTriangleResult();
    second.mesh.bytes[100] = 5;
    const view = render(<ModelViewer colors={darkColors} result={first} />);

    view.rerender(<ModelViewer colors={darkColors} result={second} />);

    expect(workers).toHaveLength(2);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].terminate).not.toHaveBeenCalled();
  });
});
