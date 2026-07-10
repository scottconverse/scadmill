import { describe, expect, it, vi } from "vitest";

import { NativeEngineService, type NativeEngineBridge } from "../../../src/application/engine/native-engine-service";
import type { RenderRequest, RenderSuccess3D } from "../../../src/application/engine/contracts";

const request: RenderRequest = {
  entryFile: "main.scad",
  files: new Map([["main.scad", "cube(10);"]]),
  parameters: {},
  quality: "preview",
  timeoutMs: 30_000,
};

function bridge(render: NativeEngineBridge["render"]): NativeEngineBridge {
  return {
    render,
    export: vi.fn(),
    version: vi.fn().mockResolvedValue({ version: "2021.01", path: "native", features: [] }),
    cancel: vi.fn(),
  };
}

describe("NativeEngineService", () => {
  it("returns immediately and resolves the bridge result under its job id", async () => {
    const success: RenderSuccess3D = {
      kind: "3d",
      mesh: { format: "stl-binary", bytes: new Uint8Array([1, 2, 3]) },
      stats: { triangles: 12, engineTimeMs: 5 },
      diagnostics: [],
      rawLog: "rendered",
    };
    const nativeBridge = bridge(vi.fn().mockResolvedValue(success));
    const service = new NativeEngineService(nativeBridge, () => "job-1");

    const job = service.render(request);

    expect(job.jobId).toBe("job-1");
    await expect(job.done).resolves.toBe(success);
    expect(nativeBridge.render).toHaveBeenCalledWith("job-1", request, expect.any(Function));
  });

  it("converts a rejected bridge call into the single render-failure path", async () => {
    const service = new NativeEngineService(
      bridge(vi.fn().mockRejectedValue(new Error("subprocess unavailable"))),
      () => "job-2",
    );

    await expect(service.render(request).done).resolves.toEqual({
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "subprocess unavailable" }],
      rawLog: "subprocess unavailable",
    });
  });

  it("replays output emitted before a caller subscribes", async () => {
    const nativeBridge = bridge(vi.fn().mockImplementation((_jobId, _request, onOutput) => {
      onOutput({ sequence: 0, elapsedMs: 3, stream: "stderr", raw: "WARNING: early\n" });
      return Promise.resolve({
        kind: "failure",
        reason: "engine-error",
        diagnostics: [],
        rawLog: "WARNING: early\n",
      });
    }));
    const job = new NativeEngineService(nativeBridge, () => "job-stream").render(request);
    const output = vi.fn();

    const unsubscribe = job.subscribeOutput?.(output);
    await job.done;
    unsubscribe?.();

    expect(output).toHaveBeenCalledWith({
      sequence: 0,
      elapsedMs: 3,
      stream: "stderr",
      raw: "WARNING: early\n",
    });
  });
});
