import { describe, expect, it, vi } from "vitest";
import type { EngineService, RenderSuccess3D } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { createWorkbenchMcpHandler } from "../../../src/application/mcp/workbench-mcp-handler";

function engine(): EngineService {
  const result: RenderSuccess3D = {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: new Uint8Array([1, 2]) },
    stats: { triangles: 1, engineTimeMs: 2 },
    diagnostics: [{ severity: "info", message: "ok" }],
    rawLog: "",
  };
  return {
    render: vi.fn().mockReturnValue({ jobId: "mcp-render-1", done: Promise.resolve(result) }),
    export: vi.fn().mockReturnValue({ jobId: "mcp-export-1", done: Promise.resolve({ ok: true, bytes: new Uint8Array([1, 2, 3]), diagnostics: [], rawLog: "" }) }),
    version: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
  };
}

describe("workbench MCP handler", () => {
  it("reads overlaid buffers and exposes parameter metadata", async () => {
    const runtime = createWorkbenchRuntime(engine(), { initialScratchSource: "length = 5; cube(length);" });
    const handler = createWorkbenchMcpHandler({ runtime, reviewId: () => "fixed" });
    await expect(handler.call("list_files", {})).resolves.toEqual({ files: [{ path: "main.scad", sizeBytes: 25, kind: "scad" }] });
    await expect(handler.call("read_file", { path: "main.scad" })).resolves.toMatchObject({ path: "main.scad", dirty: false });
    await expect(handler.call("get_parameters", { path: "main.scad" })).resolves.toMatchObject({ parameters: [expect.objectContaining({ name: "length", default: 5, current: 5 })] });
    runtime.dispose();
  });

  it("keeps mutating calls behind the review gate and renders previews", async () => {
    const renderEngine = engine();
    const runtime = createWorkbenchRuntime(renderEngine, { initialScratchSource: "cube(1);" });
    const reviews: string[] = [];
    const handler = createWorkbenchMcpHandler({ runtime, engine: renderEngine, reviewId: () => "fixed", onPendingReview: (review) => reviews.push(review.tool) });
    await expect(handler.call("write_file", { path: "main.scad", content: "cube(2);" })).resolves.toEqual({ status: "pending_review", commandId: "mcp-review-fixed" });
    await expect(handler.call("set_parameters", { path: "main.scad", values: { missing: 2 } })).resolves.toMatchObject({ status: "pending_review", commandId: "mcp-review-fixed", unknownNames: ["missing"] });
    expect(reviews).toEqual(["write_file", "set_parameters"]);
    await expect(handler.call("render_preview", { path: "main.scad" })).resolves.toMatchObject({ kind: "3d", stats: { triangles: 1 } });
    await expect(handler.call("get_diagnostics", { path: "main.scad" })).resolves.toMatchObject({ renderId: "mcp-render-1", quality: "preview", diagnostics: [{ message: "ok" }] });
    runtime.dispose();
  });

  it("exports through the configured artifact destination", async () => {
    const destination = { available: true as const, kind: "custom" as const, save: vi.fn().mockResolvedValue({ location: "exports/model.stl" }) };
    const renderEngine = engine();
    const runtime = createWorkbenchRuntime(renderEngine, { artifactDestination: destination, initialScratchSource: "cube(1);" });
    const handler = createWorkbenchMcpHandler({ runtime, engine: renderEngine });
    await expect(handler.call("export_model", { path: "main.scad", format: "stl-binary" })).resolves.toMatchObject({ status: "ok", outputPath: "exports/model.stl", sizeBytes: 3 });
    expect(destination.save).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("returns a requested-size viewport PNG through the MCP screenshot contract", async () => {
    const runtime = createWorkbenchRuntime(engine(), { initialScratchSource: "cube(1);" });
    const captureScreenshot = vi.fn().mockResolvedValue(Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10));
    const handler = createWorkbenchMcpHandler({ runtime, captureScreenshot });

    await expect(handler.call("take_screenshot", { width: 640, height: 480 })).resolves.toEqual({
      mimeType: "image/png",
      data: "iVBORw0KGgo=",
    });
    expect(captureScreenshot).toHaveBeenCalledWith(640, 480);
    runtime.dispose();
  });
});
