// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { thumbnailPng, type ViewerResources } from "../../../src/ui/viewer/model-viewer-runtime";

function resources(events: string[]): ViewerResources {
  return {
    renderer: {
      setSize: vi.fn((width: number, height: number) => events.push(`size:${width}x${height}`)),
      render: vi.fn(() => events.push("render")),
    } as never,
    scene: {} as never,
    camera: {} as never,
    controls: {} as never,
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
  it("renders at the fixed thumbnail size and restores the viewport", async () => {
    const events: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.toBlob = (callback) => { events.push("encode"); callback(new Blob([new Uint8Array([1, 2, 3])])); };
    const bytes = await thumbnailPng(resources(events), canvas);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(events).toEqual(["size:240x160", "render", "encode", "size:640x480", "render"]);
  });

  it("restores the viewport when encoding fails", async () => {
    const events: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.toBlob = (callback) => { events.push("encode"); callback(null); };
    await expect(thumbnailPng(resources(events), canvas)).rejects.toThrow();
    expect(events).toEqual(["size:240x160", "render", "encode", "size:640x480", "render"]);
  });
});
