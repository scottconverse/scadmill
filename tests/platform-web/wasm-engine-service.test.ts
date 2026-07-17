import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ExportRequest,
  RenderRequest,
  RenderSuccess3D,
} from "../../src/application/engine/contracts";
import type {
  WasmEngineWorkerLike,
  WasmEngineWorkerRequest,
} from "../../src/platform-web/wasm-engine-protocol";
import { WasmEngineService } from "../../src/platform-web/wasm-engine-service";

class FakeWorker implements WasmEngineWorkerLike {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: { readonly message?: string }) => void) | null = null;
  readonly sent: WasmEngineWorkerRequest[] = [];
  readonly terminate = vi.fn();
  postError?: Error;

  postMessage(message: WasmEngineWorkerRequest, transfer: readonly Transferable[] = []): void {
    if (this.postError) throw this.postError;
    this.sent.push(structuredClone(message, { transfer: [...transfer] }));
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  crash(message: string): void {
    this.onerror?.({ message });
  }
}

function serviceHarness(options: { readonly versionTimeoutMs?: number } = {}) {
  const workers: FakeWorker[] = [];
  let nextId = 0;
  const service = new WasmEngineService({
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    makeJobId: () => `wasm-${++nextId}`,
    ...options,
  });
  return { service, workers };
}

function renderRequest(timeoutMs = 1_000): RenderRequest {
  return {
    entryFile: "main.scad",
    files: new Map<string, string | Uint8Array>([
      ["main.scad", "import(\"asset.stl\");"],
      ["asset.stl", new Uint8Array([0, 255, 7])],
    ]),
    parameters: { width: 12, flags: [1, 2] },
    quality: "preview",
    timeoutMs,
    previewFacetLimit: 48,
  };
}

function exportRequest(timeoutMs = 1_000): ExportRequest {
  return { ...renderRequest(timeoutMs), format: "3mf" };
}

function success(bytes = new Uint8Array([1, 2, 3])): RenderSuccess3D {
  return {
    kind: "3d",
    mesh: { format: "stl-binary", bytes },
    stats: { triangles: 1, engineTimeMs: 4 },
    diagnostics: [],
    rawLog: "rendered",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WasmEngineService", () => {
  it("accepts a valid strong identity on a two-dimensional worker result", async () => {
    const { service, workers } = serviceHarness();
    const job = service.render(renderRequest());
    const result = {
      kind: "2d" as const,
      svg: "<svg xmlns='http://www.w3.org/2000/svg'/>",
      geometryIdentity: `sha256:${"a".repeat(64)}`,
      boundingBox: { min: [0, 0] as [number, number], max: [10, 20] as [number, number] },
      diagnostics: [],
      rawLog: "rendered",
    };

    workers[0].emit({ kind: "render-result", jobId: job.jobId, result });

    await expect(job.done).resolves.toEqual(result);
  });

  it("reports only active-job progress and isolates throwing progress observers", async () => {
    const workers: FakeWorker[] = [];
    const progress = vi.fn(() => { throw new Error("observer failed"); });
    const service = new WasmEngineService({
      workerFactory: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      makeJobId: () => "active",
      onProgress: progress,
    });
    const job = service.render(renderRequest());

    workers[0].emit({
      kind: "progress",
      jobId: "stale",
      progress: { asset: "openscad.js", loadedBytes: 1, totalBytes: 10 },
    });
    workers[0].emit({
      kind: "progress",
      jobId: job.jobId,
      progress: { asset: "openscad.wasm", loadedBytes: 5, totalBytes: 10 },
    });
    workers[0].emit({ kind: "render-result", jobId: job.jobId, result: success() });

    await expect(job.done).resolves.toMatchObject({ kind: "3d" });
    expect(progress).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith({
      asset: "openscad.wasm",
      loadedBytes: 5,
      totalBytes: 10,
    });
  });

  it("isolates exceptions while replaying buffered output and during later output", async () => {
    const { service, workers } = serviceHarness();
    const job = service.render(renderRequest());
    const listener = vi.fn(() => { throw new Error("output observer failed"); });
    workers[0].emit({
      kind: "output",
      jobId: job.jobId,
      event: { sequence: 0, elapsedMs: 1, stream: "stderr", raw: "first\n" },
    });

    expect(() => job.subscribeOutput(listener)).not.toThrow();
    workers[0].emit({
      kind: "output",
      jobId: job.jobId,
      event: { sequence: 1, elapsedMs: 2, stream: "stdout", raw: "second\n" },
    });
    workers[0].emit({ kind: "render-result", jobId: job.jobId, result: success() });

    await expect(job.done).resolves.toMatchObject({ kind: "3d" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("uses a dedicated worker for version and render while preserving binary inputs and early output", async () => {
    const { service, workers } = serviceHarness();
    const version = service.version();
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual([{ kind: "version", jobId: "wasm-1" }]);
    workers[0].emit({
      kind: "version-result",
      jobId: "wasm-1",
      info: { version: "2026.06.12", path: "wasm", features: ["manifold"] },
    });
    await expect(version).resolves.toEqual({
      version: "2026.06.12",
      path: "wasm",
      features: ["manifold"],
    });

    const request = renderRequest();
    const originalBinary = request.files.get("asset.stl") as Uint8Array;
    const job = service.render(request);
    expect(job.jobId).toBe("wasm-2");
    expect(workers).toHaveLength(1);
    const sent = workers[0].sent[1];
    expect(sent.kind).toBe("render");
    if (sent.kind !== "render") throw new Error("Expected a render request.");
    expect(sent.request.files).toEqual([
      { path: "main.scad", contents: "import(\"asset.stl\");" },
      { path: "asset.stl", contents: new Uint8Array([0, 255, 7]) },
    ]);
    expect(sent.request.parameters).toEqual({ width: 12, flags: [1, 2] });
    expect(originalBinary).toEqual(new Uint8Array([0, 255, 7]));
    expect(sent.request.files[1]?.contents).not.toBe(originalBinary);

    workers[0].emit({
      kind: "output",
      jobId: job.jobId,
      event: { sequence: 0, elapsedMs: 2, stream: "stderr", raw: "WARNING: early\n" },
    });
    const output = vi.fn();
    job.subscribeOutput(output);
    expect(output).toHaveBeenCalledWith({
      sequence: 0,
      elapsedMs: 2,
      stream: "stderr",
      raw: "WARNING: early\n",
    });

    const rendered = success();
    workers[0].emit({ kind: "render-result", jobId: job.jobId, result: rendered });
    await expect(job.done).resolves.toEqual(rendered);
    expect(workers[0].terminate).not.toHaveBeenCalled();
  });

  it("returns export results through the same worker contract", async () => {
    const { service, workers } = serviceHarness();
    const job = service.export(exportRequest());
    const result = {
      ok: true,
      bytes: new Uint8Array([3, 6, 9]),
      fileExtension: "3mf",
      diagnostics: [],
      rawLog: "exported",
    };

    workers[0].emit({ kind: "export-result", jobId: job.jobId, result });

    await expect(job.done).resolves.toEqual(result);
  });

  it("terminates and settles superseded or explicitly cancelled jobs, then starts fresh", async () => {
    const { service, workers } = serviceHarness();
    const first = service.render(renderRequest());
    const second = service.render(renderRequest());

    await expect(first.done).resolves.toMatchObject({ kind: "failure", reason: "cancelled" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
    service.cancel("unknown-job");
    expect(workers[1].terminate).not.toHaveBeenCalled();

    service.cancel(second.jobId);
    service.cancel(second.jobId);
    await expect(second.done).resolves.toMatchObject({ kind: "failure", reason: "cancelled" });
    expect(workers[1].terminate).toHaveBeenCalledOnce();

    const third = service.render(renderRequest());
    expect(workers).toHaveLength(3);
    const rendered = success(new Uint8Array([9]));
    workers[2].emit({ kind: "render-result", jobId: third.jobId, result: rendered });
    await expect(third.done).resolves.toEqual(rendered);
  });

  it("terminates a timed-out worker, settles with timeout, and succeeds on a fresh worker", async () => {
    vi.useFakeTimers();
    const { service, workers } = serviceHarness();
    const timedOut = service.render(renderRequest(25));

    await vi.advanceTimersByTimeAsync(25);

    await expect(timedOut.done).resolves.toMatchObject({ kind: "failure", reason: "timeout" });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const retry = service.render(renderRequest());
    const rendered = success();
    workers[1].emit({ kind: "render-result", jobId: retry.jobId, result: rendered });
    await expect(retry.done).resolves.toEqual(rendered);
  });

  it("settles worker crashes and malformed terminal messages as values and recreates the worker", async () => {
    const { service, workers } = serviceHarness();
    const render = service.render(renderRequest());
    workers[0].crash("worker exploded");
    await expect(render.done).resolves.toMatchObject({
      kind: "failure",
      reason: "engine-error",
      rawLog: "worker exploded",
    });
    expect(workers[0].terminate).toHaveBeenCalledOnce();

    const exported = service.export(exportRequest());
    workers[1].emit({ kind: "export-result", jobId: exported.jobId, result: { ok: true } });
    await expect(exported.done).resolves.toMatchObject({ ok: false });
    expect(workers[1].terminate).toHaveBeenCalledOnce();

    const version = service.version();
    workers[2].emit({ kind: "version-result", jobId: "wasm-3", info: { path: "native" } });
    await expect(version).resolves.toBeNull();
    expect(workers[2].terminate).toHaveBeenCalledOnce();
  });

  it("ignores valid messages for a different job id", async () => {
    const { service, workers } = serviceHarness();
    const job = service.render(renderRequest());
    let settled = false;
    void job.done.then(() => { settled = true; });

    workers[0].emit({ kind: "render-result", jobId: "wrong-job", result: success() });
    await Promise.resolve();
    expect(settled).toBe(false);

    const rendered = success(new Uint8Array([8]));
    workers[0].emit({ kind: "render-result", jobId: job.jobId, result: rendered });
    await expect(job.done).resolves.toEqual(rendered);
  });

  it("isolates concurrent export and version work while only a newer render supersedes a render", async () => {
    const { service, workers } = serviceHarness();
    const firstRender = service.render(renderRequest());
    const exported = service.export(exportRequest());
    const version = service.version();

    expect(workers).toHaveLength(3);
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true);

    const replacementRender = service.render(renderRequest());
    await expect(firstRender.done).resolves.toMatchObject({
      kind: "failure",
      reason: "cancelled",
    });
    expect(workers).toHaveLength(4);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].terminate).not.toHaveBeenCalled();
    expect(workers[2].terminate).not.toHaveBeenCalled();

    const exportResult = {
      ok: true,
      bytes: new Uint8Array([4, 5, 6]),
      fileExtension: "3mf",
      diagnostics: [],
      rawLog: "exported concurrently",
    };
    workers[1].emit({ kind: "export-result", jobId: exported.jobId, result: exportResult });
    workers[2].emit({
      kind: "version-result",
      jobId: "wasm-3",
      info: { version: "2026.06.12", path: "wasm", features: [] },
    });
    const rendered = success(new Uint8Array([7]));
    workers[3].emit({
      kind: "render-result",
      jobId: replacementRender.jobId,
      result: rendered,
    });

    await expect(exported.done).resolves.toEqual(exportResult);
    await expect(version).resolves.toEqual({ version: "2026.06.12", path: "wasm", features: [] });
    await expect(replacementRender.done).resolves.toEqual(rendered);
  });

  it("times out a silent version probe and recovers on a fresh worker", async () => {
    vi.useFakeTimers();
    const { service, workers } = serviceHarness({ versionTimeoutMs: 25 });
    const timedOut = service.version();

    await vi.advanceTimersByTimeAsync(25);

    await expect(timedOut).resolves.toBeNull();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    const retry = service.version();
    expect(workers).toHaveLength(2);
    workers[1].emit({
      kind: "version-result",
      jobId: "wasm-2",
      info: { version: "2026.06.12", path: "wasm", features: [] },
    });
    await expect(retry).resolves.toEqual({ version: "2026.06.12", path: "wasm", features: [] });
  });

  it("settles worker-factory exceptions as operation values instead of rejected promises", async () => {
    let nextId = 0;
    const service = new WasmEngineService({
      workerFactory: () => { throw new Error("worker factory denied"); },
      makeJobId: () => `factory-${++nextId}`,
    });

    await expect(service.render(renderRequest()).done).resolves.toMatchObject({
      kind: "failure",
      reason: "engine-error",
      rawLog: "worker factory denied",
    });
    await expect(service.export(exportRequest()).done).resolves.toMatchObject({
      ok: false,
      rawLog: "worker factory denied",
    });
    await expect(service.version()).resolves.toBeNull();
  });

  it("settles postMessage exceptions as operation values and terminates each rejected worker", async () => {
    const workers: FakeWorker[] = [];
    let nextId = 0;
    const service = new WasmEngineService({
      workerFactory: () => {
        const worker = new FakeWorker();
        worker.postError = new Error("worker post rejected");
        workers.push(worker);
        return worker;
      },
      makeJobId: () => `post-${++nextId}`,
    });

    await expect(service.render(renderRequest()).done).resolves.toMatchObject({
      kind: "failure",
      reason: "engine-error",
      rawLog: "worker post rejected",
    });
    await expect(service.export(exportRequest()).done).resolves.toMatchObject({
      ok: false,
      rawLog: "worker post rejected",
    });
    await expect(service.version()).resolves.toBeNull();
    expect(workers).toHaveLength(3);
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
  });
});
