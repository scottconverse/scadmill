import { describe, expect, it, vi } from "vitest";

import type { PrintabilityWorkerLike } from "../../../src/application/manufacturing/printability-worker-client";
import { runPrintabilityOffThread } from "../../../src/application/manufacturing/printability-worker-client";

const configuration = { buildVolumeMm: [220, 220, 250] as const, nozzleDiameterMm: 0.4 };

function worker(response: unknown): PrintabilityWorkerLike {
  return {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(function (this: PrintabilityWorkerLike) {
      this.onmessage?.({ data: response });
    }),
    terminate: vi.fn(),
  };
}

describe("runPrintabilityOffThread", () => {
  it("accepts a strictly shaped worker report and transfers a copied mesh buffer", async () => {
    const report = {
      manifold: { status: "fail", boundaryEdges: 3, nonManifoldEdges: 0 },
      buildVolume: { status: "pass", modelSizeMm: [10, 10, 0], configuredMm: [220, 220, 250] },
      minimumFeature: { status: "not-checked", reason: "no samples" },
      overhangs: { status: "not-checked" },
    } as const;
    const instance = worker({ ok: true, report });
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(runPrintabilityOffThread(bytes, configuration, () => instance)).resolves.toEqual(report);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(instance.postMessage).toHaveBeenCalledWith(
      { bytes: expect.any(ArrayBuffer), configuration },
      [expect.any(ArrayBuffer)],
    );
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("rejects malformed worker claims", async () => {
    await expect(runPrintabilityOffThread(
      new Uint8Array([1]), configuration, () => worker({ ok: true, report: { manifold: { status: "pass" } } }),
    )).rejects.toThrow(/invalid response/i);
  });

  it("does not parse a large mesh on the main thread when workers are unavailable", async () => {
    await expect(runPrintabilityOffThread(
      new Uint8Array(1024 * 1024 + 1), configuration, undefined,
    )).rejects.toThrow(/worker support/i);
  });
});
