// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { sizedPng, thumbnailPng, type ViewerResources } from "../../../src/ui/viewer/model-viewer-runtime";

afterEach(() => vi.restoreAllMocks());

function resources(events: string[]): ViewerResources {
  return {
    renderer: {
      setSize: vi.fn((width: number, height: number) => events.push(`size:${width}x${height}`)),
      render: vi.fn(() => events.push("render")),
    } as never,
    scene: {} as never,
    camera: { position: { distanceTo: () => 1 }, updateProjectionMatrix: vi.fn() } as never,
    controls: { target: {} } as never,
    keyLight: {} as never,
    frame: null,
    width: 640,
    height: 480,
    applyCamera: vi.fn(),
    refreshAppearance: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as ViewerResources;
}

describe("thumbnailPng", () => {
  it("downsamples the stable viewport without resizing the live WebGL renderer", async () => {
    const events: string[] = [];
    const canvas = document.createElement("canvas");
    const thumbnail = document.createElement("canvas");
    const drawImage = vi.fn(() => events.push(`draw:${thumbnail.width}x${thumbnail.height}`));
    const getContext = vi.fn(() => ({ drawImage }));
    thumbnail.getContext = getContext as never;
    thumbnail.toBlob = (callback) => {
      events.push("encode");
      callback(new Blob([new Uint8Array([1, 2, 3])]));
    };
    const createElement = vi.spyOn(canvas.ownerDocument, "createElement").mockReturnValueOnce(thumbnail);
    const viewer = resources(events);

    const bytes = await thumbnailPng(viewer, canvas);

    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(events).toEqual(["render", "draw:240x160", "encode"]);
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 240, 160);
    expect(viewer.renderer.setSize).not.toHaveBeenCalled();
    createElement.mockRestore();
  });

  it("does not resize the live viewport when thumbnail encoding fails", async () => {
    const events: string[] = [];
    const canvas = document.createElement("canvas");
    const thumbnail = document.createElement("canvas");
    thumbnail.getContext = vi.fn(() => ({ drawImage: () => events.push("draw") })) as never;
    thumbnail.toBlob = (callback) => { events.push("encode"); callback(null); };
    const createElement = vi.spyOn(canvas.ownerDocument, "createElement").mockReturnValueOnce(thumbnail);
    const viewer = resources(events);

    await expect(thumbnailPng(viewer, canvas)).rejects.toThrow();

    expect(events).toEqual(["render", "draw", "encode"]);
    expect(viewer.renderer.setSize).not.toHaveBeenCalled();
    createElement.mockRestore();
  });
});

describe("sizedPng", () => {
  it("renders at the requested MCP viewport size and restores the interactive viewport", async () => {
    const events: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.toBlob = (callback) => { events.push("encode"); callback(new Blob([new Uint8Array([1, 2, 3])])); };

    await expect(sizedPng(resources(events), canvas, 640, 360)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(events).toEqual(["size:640x360", "render", "encode", "size:640x480", "render"]);
  });
});
