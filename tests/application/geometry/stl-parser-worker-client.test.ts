import { describe, expect, it, vi } from "vitest";

import {
  createReusableBinaryStlParser,
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

function validWorkerResponse() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return {
    ok: true,
    triangleCount: 1,
    positions: positions.buffer,
    normals: normals.buffer,
    bounds: { min: [0, 0, 0], max: [1, 1, 0], size: [1, 1, 0] },
  };
}

describe("off-thread binary STL parsing", () => {
  it("reuses one worker across sequential parses and terminates it on disposal", async () => {
    const terminate = vi.fn();
    const worker: StlParserWorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage() {
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
    const factory = vi.fn(() => worker);
    const parser = createReusableBinaryStlParser(factory);

    await parser.parse(oneTriangleBytes());
    await parser.parse(oneTriangleBytes());

    expect(factory).toHaveBeenCalledOnce();
    expect(terminate).not.toHaveBeenCalled();
    parser.dispose();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("replaces an aborted reusable worker before the next parse", async () => {
    const first = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const second = {
      onmessage: null,
      onerror: null,
      postMessage() {
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
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const factory = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const parser = createReusableBinaryStlParser(factory);
    const controller = new AbortController();
    const aborted = parser.parse(oneTriangleBytes(), controller.signal);
    controller.abort();

    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await expect(parser.parse(oneTriangleBytes())).resolves.toMatchObject({ triangleCount: 1 });
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
    parser.dispose();
    expect(second.terminate).toHaveBeenCalledOnce();
  });

  it("retires a reusable worker after an error or invalid response and recovers", async () => {
    const first = {
      onmessage: null,
      onerror: null,
      postMessage() { queueMicrotask(() => this.onerror?.({ message: "worker broke" })); },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const second = {
      onmessage: null,
      onerror: null,
      postMessage() { queueMicrotask(() => this.onmessage?.({ data: { ok: true } })); },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const third = {
      onmessage: null,
      onerror: null,
      postMessage() { queueMicrotask(() => this.onmessage?.({ data: validWorkerResponse() })); },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const factory = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const parser = createReusableBinaryStlParser(factory);

    await expect(parser.parse(oneTriangleBytes())).rejects.toThrow("worker broke");
    await expect(parser.parse(oneTriangleBytes())).rejects.toThrow(/response/u);
    await expect(parser.parse(oneTriangleBytes())).resolves.toMatchObject({ triangleCount: 1 });

    expect(first.terminate).toHaveBeenCalledOnce();
    expect(second.terminate).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(3);
    parser.dispose();
    expect(third.terminate).toHaveBeenCalledOnce();
  });

  it("retires a reusable worker when request transfer throws and recovers", async () => {
    const first = {
      onmessage: null,
      onerror: null,
      postMessage() { throw new Error("transfer failed"); },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const second = {
      onmessage: null,
      onerror: null,
      postMessage() { queueMicrotask(() => this.onmessage?.({ data: validWorkerResponse() })); },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const parser = createReusableBinaryStlParser(factory);

    await expect(parser.parse(oneTriangleBytes())).rejects.toThrow(/could not start/u);
    await expect(parser.parse(oneTriangleBytes())).resolves.toMatchObject({ triangleCount: 1 });

    expect(first.terminate).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledTimes(2);
    parser.dispose();
  });

  it("rejects overlap without disturbing the active reusable request", async () => {
    let reply: (() => void) | undefined;
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage() { reply = () => this.onmessage?.({ data: validWorkerResponse() }); },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const parser = createReusableBinaryStlParser(() => worker);
    const active = parser.parse(oneTriangleBytes());

    await expect(parser.parse(oneTriangleBytes())).rejects.toThrow("already parsing");
    expect(worker.terminate).not.toHaveBeenCalled();
    reply?.();
    await expect(active).resolves.toMatchObject({ triangleCount: 1 });
    parser.dispose();
  });

  it("active disposal aborts once and permanently closes the reusable parser", async () => {
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const factory = vi.fn(() => worker);
    const parser = createReusableBinaryStlParser(factory);
    const active = parser.parse(oneTriangleBytes());

    parser.dispose();
    parser.dispose();

    await expect(active).rejects.toMatchObject({ name: "AbortError" });
    await expect(parser.parse(oneTriangleBytes())).rejects.toThrow("disposed");
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledOnce();
  });

  it("ignores callbacks captured from a retired reusable worker", async () => {
    let stale: ((event: { readonly data: unknown }) => void) | null = null;
    const first = {
      onmessage: null,
      onerror: null,
      postMessage() { stale = this.onmessage; },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    let reply: (() => void) | undefined;
    const second = {
      onmessage: null,
      onerror: null,
      postMessage() { reply = () => this.onmessage?.({ data: validWorkerResponse() }); },
      terminate: vi.fn(),
    } satisfies StlParserWorkerLike;
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const parser = createReusableBinaryStlParser(factory);
    const controller = new AbortController();
    const retired = parser.parse(oneTriangleBytes(), controller.signal);
    controller.abort();
    await expect(retired).rejects.toMatchObject({ name: "AbortError" });
    const current = parser.parse(oneTriangleBytes());

    expect(stale).not.toBeNull();
    (stale as unknown as (event: { readonly data: unknown }) => void)(
      { data: validWorkerResponse() },
    );
    await expect(parser.parse(oneTriangleBytes())).rejects.toThrow("already parsing");
    expect(second.terminate).not.toHaveBeenCalled();
    reply?.();

    await expect(current).resolves.toMatchObject({ triangleCount: 1 });
    parser.dispose();
  });

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
