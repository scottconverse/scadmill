// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import {
  AmbientLight,
  BufferGeometry,
  type Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  type Scene,
} from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import { ModelViewer } from "../../../src/ui/viewer/ModelViewer";

interface RendererRecord {
  readonly render: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
}

interface ControlsRecord {
  readonly object: PerspectiveCamera;
  readonly dispose: ReturnType<typeof vi.fn>;
}

const threeHarness = vi.hoisted(() => ({
  scenes: [] as Scene[],
  renderers: [] as RendererRecord[],
  controls: [] as ControlsRecord[],
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

    constructor() {
      threeHarness.renderers.push(this);
    }
  }

  return { ...actual, Scene: TestScene, WebGLRenderer: TestWebGLRenderer };
});

vi.mock("three/examples/jsm/controls/OrbitControls.js", () => ({
  OrbitControls: class TestOrbitControls {
    readonly target = { set: vi.fn() };
    readonly update = vi.fn();
    readonly dispose = vi.fn();
    enableDamping = false;

    constructor(
      readonly object: PerspectiveCamera,
      _canvas: HTMLCanvasElement,
    ) {
      threeHarness.controls.push(this);
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

  it("hot-applies viewer colors without reconstructing Three resources", () => {
    const result = oneTriangleResult();
    const view = render(<ModelViewer result={result} colors={darkColors} />);
    const scene = threeHarness.scenes[0];
    const renderer = threeHarness.renderers[0];
    const controls = threeHarness.controls[0];
    const camera = controls.object;
    const mesh = modelMesh(scene);

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
});
