import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserWasmEngine,
  createBrowserWasmEngineProgressStore,
} from "../../src/platform-web/browser-wasm-engine";
import type {
  WasmEngineWorkerRequest,
  WasmEngineWorkerResponse,
} from "../../src/platform-web/wasm-engine-protocol";

class FakeWorker {
  static readonly created: FakeWorker[] = [];

  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;
  readonly messages: WasmEngineWorkerRequest[] = [];

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.created.push(this);
  }

  postMessage(message: WasmEngineWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {}

  respond(response: WasmEngineWorkerResponse): void {
    this.onmessage?.({ data: response });
  }
}

afterEach(() => {
  FakeWorker.created.length = 0;
  vi.unstubAllGlobals();
});

describe("browser OpenSCAD WASM engine selection", () => {
  it("uses the exact Vite module worker and publishes immutable progress snapshots", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const selection = createBrowserWasmEngine();
    const initial = selection.progress.getState();
    const observed: unknown[] = [];
    selection.progress.subscribe((state, previous) => observed.push([state, previous]));

    const version = selection.engine.version();
    const worker = FakeWorker.created[0];
    expect(worker).toBeDefined();
    expect(worker.url.pathname).toMatch(/\/openscad-wasm\.worker\.ts$/u);
    expect(worker.options).toEqual({ type: "module" });
    expect(worker.messages).toEqual([{ kind: "version", jobId: "wasm-1" }]);

    worker.respond({
      kind: "progress",
      jobId: "wasm-1",
      progress: { asset: "openscad.js", loadedBytes: 40, totalBytes: 100 },
    });
    const first = selection.progress.getState();
    worker.respond({
      kind: "progress",
      jobId: "wasm-1",
      progress: { asset: "openscad.js", loadedBytes: 100, totalBytes: 100 },
    });

    expect(initial.assets).toEqual([]);
    expect(first.assets).toEqual([
      { asset: "openscad.js", loadedBytes: 40, totalBytes: 100 },
    ]);
    expect(selection.progress.getState().assets).toEqual([
      { asset: "openscad.js", loadedBytes: 100, totalBytes: 100 },
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.assets)).toBe(true);
    expect(Object.isFrozen(first.assets[0])).toBe(true);
    expect(observed).toHaveLength(2);

    selection.clearProgress();
    expect(selection.progress.getState()).toEqual({ assets: [] });
    worker.respond({
      kind: "version-result",
      jobId: "wasm-1",
      info: { version: "2026.06.12", path: "wasm", features: [] },
    });
    await expect(version).resolves.toEqual({
      version: "2026.06.12",
      path: "wasm",
      features: [],
    });
  });

  it("does not publish duplicate or regressive progress", () => {
    const progress = createBrowserWasmEngineProgressStore();
    const listener = vi.fn();
    progress.subscribe(listener);

    progress.record({ asset: "openscad.wasm", loadedBytes: 60, totalBytes: 100 });
    progress.record({ asset: "openscad.wasm", loadedBytes: 40, totalBytes: 100 });
    progress.record({ asset: "openscad.wasm", loadedBytes: 60, totalBytes: 100 });
    progress.record({ asset: "openscad.wasm", loadedBytes: 101, totalBytes: null });

    expect(progress.getState().assets).toEqual([
      { asset: "openscad.wasm", loadedBytes: 60, totalBytes: 100 },
    ]);
    expect(listener).toHaveBeenCalledOnce();
  });
});
