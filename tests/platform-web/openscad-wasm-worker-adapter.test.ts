import { describe, expect, it, vi } from "vitest";

import type {
  EngineInfo,
  EngineOutputEvent,
  ExportResult,
  RenderResult,
} from "../../src/application/engine/contracts";
import {
  bootOpenScadWasmWorker,
  createProductionOpenScadWasmLoader,
} from "../../src/platform-web/openscad-wasm.worker";
import type { OpenScadWasmRuntime } from "../../src/platform-web/openscad-wasm-runtime";
import {
  OpenScadWasmWorkerAdapter,
  type OpenScadWasmWorkerScope,
} from "../../src/platform-web/openscad-wasm-worker-adapter";
import type {
  WasmEngineWorkerRequest,
  WasmEngineWorkerResponse,
  WasmRenderRequest,
} from "../../src/platform-web/wasm-engine-protocol";
import {
  decodeWasmEngineWorkerRequest,
  decodeWasmEngineWorkerResponse,
} from "../../src/platform-web/wasm-engine-protocol";

class FakeScope implements OpenScadWasmWorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  readonly posted: Array<{
    readonly message: WasmEngineWorkerResponse;
    readonly transfer: readonly Transferable[];
  }> = [];
  postError?: Error;
  readonly location = { href: "https://studio.example/assets/worker.js" };

  postMessage(message: WasmEngineWorkerResponse, transfer: readonly Transferable[] = []): void {
    if (this.postError) throw this.postError;
    this.posted.push({ message, transfer });
  }
}

function renderRequest(): WasmRenderRequest {
  return {
    entryFile: "main.scad",
    files: [
      { path: "main.scad", contents: "import(\"part.stl\");" },
      { path: "part.stl", contents: new Uint8Array([1, 2, 3]) },
    ],
    parameters: { width: 4 },
    quality: "preview",
    timeoutMs: 1_000,
    previewFacetLimit: 48,
  };
}

function renderMessage(
  jobId = "render-1",
): Extract<WasmEngineWorkerRequest, { readonly kind: "render" }> {
  return { kind: "render", jobId, request: renderRequest() };
}

function exportMessage(jobId: string): WasmEngineWorkerRequest {
  const { quality: _quality, ...request } = renderRequest();
  return { kind: "export", jobId, request: { ...request, format: "3mf" } };
}

function runtime(overrides: Partial<OpenScadWasmRuntime> = {}): OpenScadWasmRuntime {
  return {
    version: vi.fn(async (): Promise<EngineInfo | null> => (
      { version: "2026.06.12", path: "wasm", features: [] }
    )),
    render: vi.fn(async (): Promise<RenderResult> => ({
      kind: "3d",
      mesh: { format: "stl-binary", bytes: new Uint8Array([7, 8, 9]) },
      stats: { engineTimeMs: 1 },
      diagnostics: [],
      rawLog: "rendered",
    })),
    export: vi.fn(async (): Promise<ExportResult> => ({
      ok: true,
      bytes: new Uint8Array([4, 5]),
      fileExtension: "3mf",
      diagnostics: [],
      rawLog: "exported",
    })),
    ...overrides,
  };
}

describe("OpenScadWasmWorkerAdapter", () => {
  it("rejects sparse arrays and non-plain request, project, image, camera, and progress records", () => {
    const sparseFiles = new Array(1);
    const sparseVector = [1, 2, 3];
    delete sparseVector[1];
    const sparseTuple = [0, 0, 0];
    delete sparseTuple[2];
    const custom = <T extends object>(value: T): T => Object.setPrototypeOf(value, { inherited: true });
    const plainRender = renderMessage("shape");
    const { quality: _quality, ...plainExportRequest } = renderRequest();
    const image = { width: 10, height: 10, camera: { position: [0, 0, 1], target: [0, 0, 0], up: [0, 1, 0] } };

    const invalidRequests: unknown[] = [
      custom({ ...plainRender }),
      { ...plainRender, request: custom({ ...plainRender.request }) },
      { ...plainRender, request: { ...plainRender.request, files: sparseFiles } },
      { ...plainRender, request: { ...plainRender.request, files: [custom({ path: "main.scad", contents: "cube();" })] } },
      { ...plainRender, request: { ...plainRender.request, parameters: { size: sparseVector } } },
      { kind: "export", jobId: "image", request: { ...plainExportRequest, format: "png", image: custom({ ...image }) } },
      { kind: "export", jobId: "camera", request: { ...plainExportRequest, format: "png", image: { ...image, camera: custom({ ...image.camera }) } } },
      { kind: "export", jobId: "tuple", request: { ...plainExportRequest, format: "png", image: { ...image, camera: { ...image.camera, up: sparseTuple } } } },
    ];
    expect(invalidRequests.map(decodeWasmEngineWorkerRequest)).toEqual(
      invalidRequests.map(() => null),
    );

    const progress = { asset: "openscad.js", loadedBytes: 1, totalBytes: 2 } as const;
    expect(decodeWasmEngineWorkerResponse(custom({
      kind: "progress",
      jobId: "progress-job",
      progress,
    }))).toBeNull();
    expect(decodeWasmEngineWorkerResponse({
      kind: "progress",
      jobId: "progress-job",
      progress: custom({ ...progress }),
    })).toBeNull();
  });

  it("ignores malformed inbound values and returns an operation-shaped busy result", async () => {
    const scope = new FakeScope();
    let release!: (value: OpenScadWasmRuntime) => void;
    const loading = new Promise<OpenScadWasmRuntime>((resolve) => { release = resolve; });
    const adapter = new OpenScadWasmWorkerAdapter(scope, () => loading);

    await adapter.handleMessage({ kind: "render", jobId: "bad", request: { files: [] } });
    await adapter.handleMessage({
      ...renderMessage("array-parameters"),
      request: { ...renderRequest(), parameters: [] },
    });
    await adapter.handleMessage({
      ...renderMessage("date-parameters"),
      request: { ...renderRequest(), parameters: new Date() },
    });
    expect(decodeWasmEngineWorkerResponse({
      kind: "progress",
      jobId: "progress-job",
      progress: { asset: "openscad.js", loadedBytes: 1, totalBytes: 2 },
      extra: true,
    })).toBeNull();
    const active = adapter.handleMessage(renderMessage());
    await adapter.handleMessage({ kind: "version", jobId: "version-busy" });

    expect(scope.posted).toHaveLength(1);
    expect(scope.posted[0]?.message).toEqual({
      kind: "version-result",
      jobId: "version-busy",
      info: null,
    });
    release(runtime());
    await active;
  });

  it("binds load progress and runtime output to the active job, then reuses the runtime", async () => {
    const scope = new FakeScope();
    const engine = runtime({
      render: vi.fn(async (_request, onOutput): Promise<RenderResult> => {
        const event: EngineOutputEvent = {
          sequence: 0,
          elapsedMs: 2,
          stream: "stderr",
          raw: "WARNING: bounded\n",
        };
        onOutput?.(event);
        return {
          kind: "3d",
          mesh: { format: "stl-binary", bytes: new Uint8Array([7]) },
          stats: { engineTimeMs: 1 },
          diagnostics: [],
          rawLog: event.raw,
        };
      }),
    });
    const load = vi.fn(async (onProgress: (progress: {
      asset: "openscad.js" | "openscad.wasm";
      loadedBytes: number;
      totalBytes: number | null;
    }) => void) => {
      onProgress({ asset: "openscad.wasm", loadedBytes: 5, totalBytes: 10 });
      return engine;
    });
    const adapter = new OpenScadWasmWorkerAdapter(scope, load);

    await adapter.handleMessage(renderMessage("render-a"));
    await adapter.handleMessage({ kind: "version", jobId: "version-b" });

    expect(load).toHaveBeenCalledOnce();
    expect(scope.posted.map(({ message }) => [message.kind, message.jobId])).toEqual([
      ["progress", "render-a"],
      ["output", "render-a"],
      ["render-result", "render-a"],
      ["version-result", "version-b"],
    ]);
  });

  it("retries failed loads and maps version, Error, and non-Error failures without rejecting", async () => {
    const scope = new FakeScope();
    const engine = runtime({
      export: vi.fn(async () => { throw new Error("export exploded"); }),
      render: vi.fn(async () => { throw { privateDetail: "must not escape" }; }),
    });
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("download denied"))
      .mockRejectedValueOnce("private loader detail")
      .mockResolvedValueOnce(engine);
    const adapter = new OpenScadWasmWorkerAdapter(scope, load);

    await expect(adapter.handleMessage(renderMessage("first"))).resolves.toBeUndefined();
    await expect(adapter.handleMessage({ kind: "version", jobId: "version-failed-load" }))
      .resolves.toBeUndefined();
    await expect(adapter.handleMessage(renderMessage("non-error-runtime")))
      .resolves.toBeUndefined();
    await expect(adapter.handleMessage(exportMessage("error-runtime"))).resolves.toBeUndefined();

    expect(load).toHaveBeenCalledTimes(3);
    expect(scope.posted[0]?.message).toMatchObject({
      kind: "render-result",
      result: { kind: "failure", reason: "engine-error", rawLog: "download denied" },
    });
    expect(scope.posted[1]?.message).toEqual({
      kind: "version-result",
      jobId: "version-failed-load",
      info: null,
    });
    expect(scope.posted[2]?.message).toMatchObject({
      kind: "render-result",
      result: {
        kind: "failure",
        reason: "engine-error",
        rawLog: "The OpenSCAD WASM operation failed.",
      },
    });
    expect(scope.posted[3]?.message).toMatchObject({
      kind: "export-result",
      result: { ok: false, rawLog: "export exploded" },
    });
  });

  it("transfers exact standalone render and export subarray copies without adjacent bytes", async () => {
    const scope = new FakeScope();
    const renderBacking = new Uint8Array([99, 9, 8, 7, 88]);
    const renderBytes = renderBacking.subarray(1, 4);
    const exportBacking = new Uint8Array([77, 4, 5, 66]);
    const exportBytes = exportBacking.subarray(1, 3);
    const adapter = new OpenScadWasmWorkerAdapter(scope, async () => runtime({
      render: vi.fn(async (): Promise<RenderResult> => ({
        kind: "3d",
        mesh: { format: "stl-binary", bytes: renderBytes },
        stats: { engineTimeMs: 1 },
        diagnostics: [],
        rawLog: "ok",
      })),
      export: vi.fn(async (): Promise<ExportResult> => ({
        ok: true,
        bytes: exportBytes,
        fileExtension: "3mf",
        diagnostics: [],
        rawLog: "ok",
      })),
    }));

    await adapter.handleMessage(renderMessage());
    await adapter.handleMessage(exportMessage("export-1"));

    const rendered = scope.posted[0];
    if (rendered?.message.kind !== "render-result" || rendered.message.result.kind !== "3d") {
      throw new Error("Expected a 3D render result.");
    }
    expect(rendered.message.result.mesh.bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(rendered.message.result.mesh.bytes).not.toBe(renderBytes);
    expect(rendered.message.result.mesh.bytes.buffer.byteLength).toBe(3);
    expect(rendered.transfer).toEqual([rendered.message.result.mesh.bytes.buffer]);

    const exported = scope.posted[1];
    if (exported?.message.kind !== "export-result" || !exported.message.result.bytes) {
      throw new Error("Expected an export result with bytes.");
    }
    expect(exported.message.result.bytes).toEqual(new Uint8Array([4, 5]));
    expect(exported.message.result.bytes).not.toBe(exportBytes);
    expect(exported.message.result.bytes.buffer.byteLength).toBe(2);
    expect(exported.transfer).toEqual([exported.message.result.bytes.buffer]);
    expect(renderBacking).toEqual(new Uint8Array([99, 9, 8, 7, 88]));
    expect(exportBacking).toEqual(new Uint8Array([77, 4, 5, 66]));
  });

  it("creates the production cache lazily once and reuses it after a failed load", async () => {
    const scope = new FakeScope();
    const cache = { read: vi.fn(), write: vi.fn(), remove: vi.fn() };
    const createCache = vi.fn(() => cache);
    const loadVerified = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(runtime());
    const load = createProductionOpenScadWasmLoader(scope, { createCache, loadVerified });

    expect(createCache).not.toHaveBeenCalled();
    await expect(load(() => undefined)).rejects.toThrow("offline");
    await expect(load(() => undefined)).resolves.toBeDefined();

    expect(createCache).toHaveBeenCalledOnce();
    expect(loadVerified).toHaveBeenCalledTimes(2);
    expect(loadVerified.mock.calls.map(([options]) => ({
      artifactBaseUrl: String(options.artifactBaseUrl),
      cache: options.cache,
    }))).toEqual([
      { artifactBaseUrl: "https://studio.example/openscad-engine/", cache },
      { artifactBaseUrl: "https://studio.example/openscad-engine/", cache },
    ]);
  });

  it("keeps separately fetched engine assets beneath a configured static-host subpath", async () => {
    const scope = new FakeScope();
    const cache = { read: vi.fn(), write: vi.fn(), remove: vi.fn() };
    const loadVerified = vi.fn().mockResolvedValue(runtime());
    const load = createProductionOpenScadWasmLoader(
      scope,
      { createCache: () => cache, loadVerified },
      "/scadmill/",
    );

    await expect(load(() => undefined)).resolves.toBeDefined();

    expect(String(loadVerified.mock.calls[0]?.[0].artifactBaseUrl)).toBe(
      "https://studio.example/scadmill/openscad-engine/",
    );
  });

  it("isolates postMessage failures and boots the production message handler", async () => {
    const scope = new FakeScope();
    scope.postError = new Error("port closed");
    const adapter = bootOpenScadWasmWorker(scope, async () => runtime());

    expect(scope.onmessage).not.toBeNull();
    await expect(adapter.handleMessage({ kind: "version", jobId: "direct" }))
      .resolves.toBeUndefined();
    scope.postError = undefined;
    scope.onmessage?.({ data: { kind: "version", jobId: "booted" } });
    await vi.waitFor(() => expect(scope.posted).toHaveLength(1));
    expect(scope.posted[0]?.message).toMatchObject({
      kind: "version-result",
      jobId: "booted",
    });
  });
});
