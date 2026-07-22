import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  canonicalThreeMfGeometryBytesOffThread,
  type ThreeMfCanonicalizerWorkerLike,
} from "../../../src/application/geometry/three-mf-canonicalizer-worker-client";

function worker(
  respond: (candidate: ThreeMfCanonicalizerWorkerLike) => void,
): ThreeMfCanonicalizerWorkerLike & { readonly transferred: ArrayBuffer[]; terminated: boolean } {
  const transferred: ArrayBuffer[] = [];
  return {
    onmessage: null,
    onerror: null,
    transferred,
    terminated: false,
    postMessage(_message, transfer) {
      transferred.push(...transfer.filter((item): item is ArrayBuffer => item instanceof ArrayBuffer));
      queueMicrotask(() => respond(this));
    },
    terminate() { this.terminated = true; },
  };
}

describe("3MF canonicalizer worker client", () => {
  it("transfers a copy, decodes canonical bytes, and retires the worker", async () => {
    const supplied = worker((candidate) => candidate.onmessage?.({
      data: { ok: true, bytes: Uint8Array.of(4, 5, 6).buffer },
    }));
    const original = Uint8Array.of(1, 2, 3);

    await expect(canonicalThreeMfGeometryBytesOffThread(original, () => supplied))
      .resolves.toEqual(Uint8Array.of(4, 5, 6));
    expect(original).toEqual(Uint8Array.of(1, 2, 3));
    expect(supplied.transferred).toHaveLength(1);
    expect(supplied.terminated).toBe(true);
  });

  it("rejects malformed worker responses and retires the worker", async () => {
    const supplied = worker((candidate) => candidate.onmessage?.({ data: { ok: true, bytes: "bad" } }));

    await expect(canonicalThreeMfGeometryBytesOffThread(Uint8Array.of(1), () => supplied))
      .rejects.toThrow("invalid response");
    expect(supplied.terminated).toBe(true);
  });

  it("refuses a large main-thread fallback when workers are unavailable", async () => {
    await expect(canonicalThreeMfGeometryBytesOffThread(new Uint8Array(1024 * 1024 + 1)))
      .rejects.toThrow("too large");
  });

  it("rejects a small compressed archive whose model expands past the fallback cap", async () => {
    const compressed = zipSync({
      "3D/3dmodel.model": new Uint8Array(8 * 1024 * 1024 + 1),
    }, { level: 9 });
    expect(compressed.byteLength).toBeLessThan(1024 * 1024);

    await expect(canonicalThreeMfGeometryBytesOffThread(compressed))
      .rejects.toThrow("model XML exceeds");
  });
});
