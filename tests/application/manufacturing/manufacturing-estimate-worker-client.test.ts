import { describe, expect, it, vi } from "vitest";

import type { ManufacturingEstimateWorkerLike } from "../../../src/application/manufacturing/manufacturing-estimate-worker-client";
import { prepareManufacturingEstimateStlOffThread } from "../../../src/application/manufacturing/manufacturing-estimate-worker-client";

function worker(response: unknown): ManufacturingEstimateWorkerLike {
  return {
    onmessage: null,
    onerror: null,
    postMessage: vi.fn(function (this: ManufacturingEstimateWorkerLike) {
      this.onmessage?.({ data: response });
    }),
    terminate: vi.fn(),
  };
}

describe("prepareManufacturingEstimateStlOffThread", () => {
  it("transfers a copied full-render mesh and accepts only a binary STL buffer", async () => {
    const converted = Uint8Array.of(4, 5, 6);
    const instance = worker({ ok: true, stl: converted.buffer });
    const bytes = Uint8Array.of(1, 2, 3);

    await expect(prepareManufacturingEstimateStlOffThread(
      bytes,
      "3mf",
      () => instance,
    )).resolves.toEqual(converted);
    expect(bytes).toEqual(Uint8Array.of(1, 2, 3));
    expect(instance.postMessage).toHaveBeenCalledWith({
      bytes: expect.any(ArrayBuffer),
      format: "3mf",
    }, [expect.any(ArrayBuffer)]);
    expect(instance.terminate).toHaveBeenCalledOnce();
  });

  it("rejects malformed worker claims", async () => {
    for (const response of [
      { ok: true, stl: Uint8Array.of(1) },
      { ok: true, stl: new ArrayBuffer(0) },
      { ok: true, stl: Uint8Array.of(1).buffer, unexpected: true },
    ]) {
      await expect(prepareManufacturingEstimateStlOffThread(
        Uint8Array.of(1), "stl-binary", () => worker(response),
      )).rejects.toThrow(/invalid response/i);
    }
  });

  it("cancels before work starts and retires an active worker on abort", async () => {
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const factory = vi.fn(() => worker({ ok: true, stl: Uint8Array.of(1).buffer }));
    await expect(prepareManufacturingEstimateStlOffThread(
      Uint8Array.of(1), "stl-binary", factory, alreadyAborted.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(factory).not.toHaveBeenCalled();

    const controller = new AbortController();
    const instance = worker({ ok: true, stl: Uint8Array.of(1).buffer });
    instance.postMessage = vi.fn();
    const pending = prepareManufacturingEstimateStlOffThread(
      Uint8Array.of(1), "stl-binary", () => instance, controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(instance.terminate).toHaveBeenCalledOnce();
  });
});
