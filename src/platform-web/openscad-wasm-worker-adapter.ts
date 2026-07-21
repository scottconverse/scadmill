import type {
  EngineOutputEvent,
  ExportResult,
  RenderResult,
} from "../application/engine/contracts";
import type { OpenScadWasmRuntime } from "./openscad-wasm-runtime";
import {
  decodeWasmEngineWorkerRequest,
  type WasmEngineLoadProgress,
  type WasmEngineWorkerRequest,
  type WasmEngineWorkerResponse,
} from "./wasm-engine-protocol";

export interface OpenScadWasmWorkerScope {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  readonly location: { readonly href: string };
  postMessage(message: WasmEngineWorkerResponse, transfer?: readonly Transferable[]): void;
}

export type OpenScadWasmRuntimeLoader = (
  onProgress: (progress: WasmEngineLoadProgress) => void,
) => Promise<OpenScadWasmRuntime>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The OpenSCAD WASM operation failed.";
}

function renderFailure(message: string): RenderResult {
  return {
    kind: "failure",
    reason: "engine-error",
    diagnostics: [{ severity: "error", message }],
    rawLog: message,
  };
}

function exportFailure(message: string): ExportResult {
  return {
    ok: false,
    diagnostics: [{ severity: "error", message }],
    rawLog: message,
  };
}

function busyResponse(request: WasmEngineWorkerRequest): WasmEngineWorkerResponse {
  const message = "The OpenSCAD WASM worker is already processing another operation.";
  if (request.kind === "version") {
    return { kind: "version-result", jobId: request.jobId, info: null };
  }
  if (request.kind === "render") {
    return { kind: "render-result", jobId: request.jobId, result: renderFailure(message) };
  }
  return { kind: "export-result", jobId: request.jobId, result: exportFailure(message) };
}

function copiedRenderResponse(jobId: string, result: RenderResult): {
  readonly response: WasmEngineWorkerResponse;
  readonly transfer: readonly Transferable[];
} {
  if (result.kind !== "3d") {
    return { response: { kind: "render-result", jobId, result }, transfer: [] };
  }
  const bytes = result.mesh.bytes.slice();
  return {
    response: {
      kind: "render-result",
      jobId,
      result: { ...result, mesh: { ...result.mesh, bytes } },
    },
    transfer: [bytes.buffer as ArrayBuffer],
  };
}

function copiedExportResponse(jobId: string, result: ExportResult): {
  readonly response: WasmEngineWorkerResponse;
  readonly transfer: readonly Transferable[];
} {
  if (!result.bytes) {
    return { response: { kind: "export-result", jobId, result }, transfer: [] };
  }
  const bytes = result.bytes.slice();
  return {
    response: { kind: "export-result", jobId, result: { ...result, bytes } },
    transfer: [bytes.buffer as ArrayBuffer],
  };
}

export class OpenScadWasmWorkerAdapter {
  private activeJobId: string | null = null;
  private runtime: Promise<OpenScadWasmRuntime> | null = null;

  constructor(
    private readonly scope: OpenScadWasmWorkerScope,
    private readonly loadRuntime: OpenScadWasmRuntimeLoader,
  ) {}

  async handleMessage(value: unknown): Promise<void> {
    const request = decodeWasmEngineWorkerRequest(value);
    if (!request) return;
    if (this.activeJobId !== null) {
      this.post(busyResponse(request));
      return;
    }
    this.activeJobId = request.jobId;
    try {
      const runtime = await this.loadedRuntime(request.jobId);
      await this.run(runtime, request);
    } catch (error) {
      this.postFailure(request, errorMessage(error));
    } finally {
      if (this.activeJobId === request.jobId) this.activeJobId = null;
    }
  }

  private loadedRuntime(jobId: string): Promise<OpenScadWasmRuntime> {
    if (this.runtime) return this.runtime;
    const loading = this.loadRuntime((progress) => {
      if (this.activeJobId === jobId) this.post({ kind: "progress", jobId, progress });
    });
    this.runtime = loading;
    void loading.catch(() => {
      if (this.runtime === loading) this.runtime = null;
    });
    return loading;
  }

  private async run(runtime: OpenScadWasmRuntime, request: WasmEngineWorkerRequest): Promise<void> {
    if (request.kind === "version") {
      const info = await runtime.version();
      this.post({ kind: "version-result", jobId: request.jobId, info });
      return;
    }
    const output = (event: EngineOutputEvent) => {
      if (this.activeJobId === request.jobId) {
        this.post({ kind: "output", jobId: request.jobId, event });
      }
    };
    if (request.kind === "render") {
      const result = await runtime.render(request.request, output);
      const payload = copiedRenderResponse(request.jobId, result);
      this.post(payload.response, payload.transfer);
      return;
    }
    const result = await runtime.export(request.request, output);
    const payload = copiedExportResponse(request.jobId, result);
    this.post(payload.response, payload.transfer);
  }

  private postFailure(request: WasmEngineWorkerRequest, message: string): void {
    if (request.kind === "version") {
      this.post({ kind: "version-result", jobId: request.jobId, info: null });
    } else if (request.kind === "render") {
      this.post({ kind: "render-result", jobId: request.jobId, result: renderFailure(message) });
    } else {
      this.post({ kind: "export-result", jobId: request.jobId, result: exportFailure(message) });
    }
  }

  private post(message: WasmEngineWorkerResponse, transfer: readonly Transferable[] = []): void {
    try {
      this.scope.postMessage(message, transfer);
    } catch {
      // A closed or failed port cannot be repaired inside the worker.
    }
  }
}
