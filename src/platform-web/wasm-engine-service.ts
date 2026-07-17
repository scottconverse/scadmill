import type {
  EngineInfo,
  EngineOutputEvent,
  EngineService,
  ExportRequest,
  ExportResult,
  RenderJob,
  RenderRequest,
  RenderResult,
} from "../application/engine/contracts";
import {
  decodeWasmEngineWorkerResponse,
  exportWorkerPayload,
  renderWorkerPayload,
  type WasmEngineLoadProgress,
  type WasmEngineWorkerFactory,
  type WasmEngineWorkerLike,
  type WasmEngineWorkerPayload,
} from "./wasm-engine-protocol";

export interface WasmEngineServiceOptions {
  readonly workerFactory: WasmEngineWorkerFactory;
  readonly makeJobId?: () => string;
  readonly versionTimeoutMs?: number;
  readonly onProgress?: (progress: WasmEngineLoadProgress) => void;
}

export const DEFAULT_WASM_ENGINE_VERSION_TIMEOUT_MS = 30_000;

interface OutputSubscription {
  readonly emit: (event: EngineOutputEvent) => void;
  readonly subscribe: (listener: (event: EngineOutputEvent) => void) => () => void;
}

type Operation =
  | {
      readonly kind: "version";
      readonly jobId: string;
      readonly resolve: (info: EngineInfo | null) => void;
    }
  | {
      readonly kind: "render";
      readonly jobId: string;
      readonly resolve: (result: RenderResult) => void;
      readonly output: OutputSubscription;
    }
  | {
      readonly kind: "export";
      readonly jobId: string;
      readonly resolve: (result: ExportResult) => void;
      readonly output: OutputSubscription;
    };

interface WorkerRecord {
  readonly worker: WasmEngineWorkerLike;
  activeJobId: string | null;
}

type PendingOperation = Operation & {
  readonly worker: WorkerRecord;
  timer?: ReturnType<typeof setTimeout>;
};

function outputSubscription(): OutputSubscription {
  const events: EngineOutputEvent[] = [];
  const listeners = new Set<(event: EngineOutputEvent) => void>();
  return {
    emit: (event) => {
      events.push(event);
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // Output observers are outside the worker operation lifecycle.
        }
      }
    },
    subscribe: (listener) => {
      for (const event of events) {
        try {
          listener(event);
        } catch {
          // Buffered output observers are outside the worker operation lifecycle.
        }
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function renderFailure(
  reason: "engine-error" | "timeout" | "cancelled",
  message: string,
): RenderResult {
  return {
    kind: "failure",
    reason,
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

export class WasmEngineService implements EngineService {
  private readonly pending = new Map<string, PendingOperation>();
  private idleWorker: WorkerRecord | null = null;
  private activeRenderJobId: string | null = null;
  private nextJobId = 0;

  constructor(private readonly options: WasmEngineServiceOptions) {}

  render(request: RenderRequest): RenderJob<RenderResult> {
    const jobId = this.makeJobId();
    const output = outputSubscription();
    let resolve!: (result: RenderResult) => void;
    const done = new Promise<RenderResult>((accept) => { resolve = accept; });
    this.start(
      { kind: "render", jobId, resolve, output },
      renderWorkerPayload(jobId, request),
      request.timeoutMs,
    );
    return { jobId, done, subscribeOutput: output.subscribe };
  }

  export(request: ExportRequest): RenderJob<ExportResult> {
    const jobId = this.makeJobId();
    const output = outputSubscription();
    let resolve!: (result: ExportResult) => void;
    const done = new Promise<ExportResult>((accept) => { resolve = accept; });
    this.start(
      { kind: "export", jobId, resolve, output },
      exportWorkerPayload(jobId, request),
      request.timeoutMs,
    );
    return { jobId, done, subscribeOutput: output.subscribe };
  }

  version(): Promise<EngineInfo | null> {
    const jobId = this.makeJobId();
    return new Promise((resolve) => {
      this.start(
        { kind: "version", jobId, resolve },
        { message: { kind: "version", jobId }, transfer: [] },
        this.versionTimeoutMs(),
      );
    });
  }

  cancel(jobId: string): void {
    this.failJob(jobId, "cancelled", "OpenSCAD WASM job cancelled.", true);
  }

  private makeJobId(): string {
    return this.options.makeJobId?.() ?? `wasm-${++this.nextJobId}`;
  }

  private start(
    operation: Operation,
    payload: WasmEngineWorkerPayload,
    timeoutMs?: number,
  ): void {
    if (operation.kind === "render" && this.activeRenderJobId) {
      this.failJob(
        this.activeRenderJobId,
        "cancelled",
        "OpenSCAD WASM render superseded.",
        true,
      );
    }
    let worker: WorkerRecord;
    try {
      worker = this.acquireWorker();
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The OpenSCAD WASM worker could not start.";
      this.settleOperation(operation, "engine-error", message);
      return;
    }
    const pending = { ...operation, worker } as PendingOperation;
    worker.activeJobId = operation.jobId;
    this.pending.set(operation.jobId, pending);
    if (operation.kind === "render") this.activeRenderJobId = operation.jobId;
    if (timeoutMs !== undefined) {
      pending.timer = setTimeout(() => {
        this.failJob(
          pending.jobId,
          "timeout",
          `OpenSCAD WASM operation timed out after ${timeoutMs} ms.`,
          true,
        );
      }, Math.max(0, timeoutMs));
    }
    try {
      worker.worker.postMessage(payload.message, payload.transfer);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The OpenSCAD WASM worker rejected the operation.";
      this.failJob(operation.jobId, "engine-error", message, true);
    }
  }

  private acquireWorker(): WorkerRecord {
    const idle = this.idleWorker;
    if (idle) {
      this.idleWorker = null;
      return idle;
    }
    const worker = this.options.workerFactory();
    const record: WorkerRecord = { worker, activeJobId: null };
    worker.onmessage = ({ data }) => {
      this.handleMessage(record, data);
    };
    worker.onerror = ({ message }) => {
      this.handleWorkerError(record, message);
    };
    return record;
  }

  private handleMessage(worker: WorkerRecord, value: unknown): void {
    const response = decodeWasmEngineWorkerResponse(value);
    if (!response) {
      if (worker.activeJobId) {
        this.failJob(
          worker.activeJobId,
          "engine-error",
          "The OpenSCAD WASM worker returned an invalid response.",
          true,
        );
      } else {
        this.terminateWorker(worker);
      }
      return;
    }
    if (response.jobId !== worker.activeJobId) return;
    const pending = this.pending.get(response.jobId);
    if (!pending || pending.worker !== worker) return;
    if (response.kind === "progress") {
      try {
        this.options.onProgress?.(response.progress);
      } catch {
        // Download observers cannot interrupt an engine operation.
      }
      return;
    }
    if (response.kind === "output") {
      if (pending.kind !== "version") pending.output.emit(response.event);
      return;
    }
    if (response.kind === "version-result" && pending.kind === "version") {
      this.finishJob(pending, () => pending.resolve(response.info));
      return;
    }
    if (response.kind === "render-result" && pending.kind === "render") {
      this.finishJob(pending, () => pending.resolve(response.result));
      return;
    }
    if (response.kind === "export-result" && pending.kind === "export") {
      this.finishJob(pending, () => pending.resolve(response.result));
      return;
    }
    this.failJob(
      pending.jobId,
      "engine-error",
      "The OpenSCAD WASM worker returned a response for the wrong operation.",
      true,
    );
  }

  private handleWorkerError(worker: WorkerRecord, message?: string): void {
    if (worker.activeJobId) {
      this.failJob(
        worker.activeJobId,
        "engine-error",
        typeof message === "string" && message.length > 0
          ? message
          : "The OpenSCAD WASM worker crashed.",
        true,
      );
    } else {
      this.terminateWorker(worker);
    }
  }

  private finishJob(pending: PendingOperation, resolve: () => void): void {
    if (this.pending.get(pending.jobId) !== pending) return;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    this.pending.delete(pending.jobId);
    if (this.activeRenderJobId === pending.jobId) this.activeRenderJobId = null;
    pending.worker.activeJobId = null;
    this.releaseWorker(pending.worker);
    resolve();
  }

  private failJob(
    jobId: string,
    reason: "engine-error" | "timeout" | "cancelled",
    message: string,
    terminate: boolean,
  ): void {
    const pending = this.pending.get(jobId);
    if (!pending) return;
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    this.pending.delete(jobId);
    if (this.activeRenderJobId === jobId) this.activeRenderJobId = null;
    pending.worker.activeJobId = null;
    if (terminate) {
      this.terminateWorker(pending.worker);
    } else {
      this.releaseWorker(pending.worker);
    }
    this.settleOperation(pending, reason, message);
  }

  private settleOperation(
    operation: Operation,
    reason: "engine-error" | "timeout" | "cancelled",
    message: string,
  ): void {
    if (operation.kind === "version") operation.resolve(null);
    else if (operation.kind === "render") operation.resolve(renderFailure(reason, message));
    else operation.resolve(exportFailure(message));
  }

  private releaseWorker(worker: WorkerRecord): void {
    if (!this.idleWorker) {
      this.idleWorker = worker;
    } else {
      this.terminateWorker(worker);
    }
  }

  private terminateWorker(record: WorkerRecord): void {
    if (this.idleWorker === record) this.idleWorker = null;
    record.activeJobId = null;
    record.worker.onmessage = null;
    record.worker.onerror = null;
    record.worker.terminate();
  }

  private versionTimeoutMs(): number {
    const configured = this.options.versionTimeoutMs;
    return typeof configured === "number" && Number.isFinite(configured) && configured >= 0
      ? configured
      : DEFAULT_WASM_ENGINE_VERSION_TIMEOUT_MS;
  }
}
