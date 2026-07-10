import { describe, expect, it, vi } from "vitest";

import type { RenderRequest } from "../../src/application/engine/contracts";
import { createTauriBridge } from "../../src/platform-desktop/tauri-bridge";

const request: RenderRequest = {
  entryFile: "main.scad",
  files: new Map([["main.scad", "cube(10);"]]),
  parameters: {},
  quality: "preview",
  timeoutMs: 30_000,
};

describe("createTauriBridge", () => {
  it("decodes native mesh bytes and maps geometry statistics", async () => {
    const invoke = vi.fn().mockResolvedValue({
      kind: "3d",
      format: "stl-binary",
      meshBase64: "AQID",
      triangleCount: 12,
      bounds: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
      rawLog: "rendered",
      engineTimeMs: 9,
    });
    const bridge = createTauriBridge(invoke);

    const result = await bridge.render("job-1", request);

    expect(result).toEqual({
      kind: "3d",
      mesh: { format: "stl-binary", bytes: new Uint8Array([1, 2, 3]) },
      stats: {
        triangles: 12,
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        engineTimeMs: 9,
      },
      diagnostics: [],
      rawLog: "rendered",
    });
    expect(invoke).toHaveBeenCalledWith("render_native", {
      source: "cube(10);",
      quality: "preview",
    });
  });
});
