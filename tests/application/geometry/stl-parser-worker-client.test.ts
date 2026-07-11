import { describe, expect, it, vi } from "vitest";

import {
  parseBinaryStlOffThread,
  type StlParserWorkerLike,
} from "../../../src/application/geometry/stl-parser-worker-client";

function oneTriangleBytes(): Uint8Array {
  const bytes = new Uint8Array(134);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((coordinate, index) => {
    view.setFloat32(96 + index * 4, coordinate, true);
  });
  return bytes;
}

describe("off-thread binary STL parsing", () => {
  it("transfers a defensive byte copy and returns transferred geometry buffers", async () => {
    const source = oneTriangleBytes();
    let transferred: ArrayBuffer | undefined;
    const terminate = vi.fn();
    const worker: StlParserWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage(message, transfer) {
        transferred = transfer[0] as ArrayBuffer;
        expect(message).toEqual({ bytes: transferred });
        const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
        const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
        queueMicrotask(() => this.onmessage?.({ data: {
          ok: true,
          triangleCount: 1,
          positions: positions.buffer,
          normals: normals.buffer,
          bounds: { min: [0, 0, 0], max: [1, 1, 0], size: [1, 1, 0] },
        } }));
      },
      terminate,
    };

    const parsed = await parseBinaryStlOffThread(source, () => worker);

    expect(transferred).not.toBe(source.buffer);
    expect(source.byteLength).toBe(134);
    expect(Array.from(parsed.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(parsed.bounds.size).toEqual([1, 1, 0]);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("rejects an invalid worker response instead of constructing unsafe geometry", async () => {
    const worker: StlParserWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: {
          ok: true,
          triangleCount: 2,
          positions: new Float32Array(9).buffer,
          normals: new Float32Array(9).buffer,
          bounds: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
        } }));
      },
      terminate: vi.fn(),
    };

    await expect(parseBinaryStlOffThread(oneTriangleBytes(), () => worker)).rejects.toThrow(/response/u);
  });

  it("returns a rejected promise when the parser worker cannot be constructed", async () => {
    let promise: Promise<unknown> | undefined;

    expect(() => {
      promise = parseBinaryStlOffThread(oneTriangleBytes(), () => {
        throw new Error("worker construction failed");
      });
    }).not.toThrow();

    await expect(promise).rejects.toThrow("The STL parser worker could not start.");
  });

  it("rejects oversized main-thread fallback work when workers are unavailable", async () => {
    const triangleCount = 22_000;
    const bytes = new Uint8Array(84 + triangleCount * 50);
    new DataView(bytes.buffer).setUint32(80, triangleCount, true);
    vi.stubGlobal("Worker", undefined);

    const promise = parseBinaryStlOffThread(bytes);

    await expect(promise).rejects.toThrow(
      "The model is too large to display without Web Worker support.",
    );
    vi.unstubAllGlobals();
  });

  it("terminates an unfinished parser worker when parsing is aborted", () => {
    const terminate = vi.fn();
    const worker: StlParserWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate,
    };
    const controller = new AbortController();

    void parseBinaryStlOffThread(oneTriangleBytes(), () => worker, controller.signal)
      .catch(() => undefined);
    controller.abort();

    expect(terminate).toHaveBeenCalledOnce();
  });
});
