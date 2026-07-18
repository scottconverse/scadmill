import {
  type CurrentFileIndexResult,
  indexOpenScadCurrentFileCooperatively,
} from "./openscad-current-file-index";
import {
  abortError,
  indexOpenScadProject,
  MAX_PROJECT_INDEX_FILE_CODE_UNITS,
  OpenScadProjectIndexCache,
  type ProjectIndexedSymbol,
  type ProjectReference,
  parseProjectFileEventsCooperatively,
} from "./openscad-project-index";

interface WorkerMessageEvent {
  readonly data: unknown;
}

export interface ProjectIndexWorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export type ProjectIndexWorkerFactory = () => ProjectIndexWorkerLike;

export interface ProjectSourceLookup {
  readonly get: (path: string) => string | undefined;
}

interface IndexInput {
  readonly documentPath: string;
  readonly references: readonly ProjectReference[];
  readonly sources: ProjectSourceLookup;
}

interface CurrentFileIndexInput {
  readonly documentPath: string;
  readonly query: string;
  readonly source: string;
}

interface PendingRequest {
  readonly input: IndexInput | CurrentFileIndexInput;
  readonly kind: "current-file" | "project";
  readonly signal: AbortSignal;
  readonly resolve: (result: CurrentFileIndexResult | readonly ProjectIndexedSymbol[]) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
}

function defaultWorkerFactory(): ProjectIndexWorkerLike {
  return new Worker(
    new URL("./openscad-project-index.worker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as ProjectIndexWorkerLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProjectIndexedSymbol(value: unknown): value is ProjectIndexedSymbol {
  if (!isRecord(value)) return false;
  return (
    typeof value.label === "string"
    && typeof value.detail === "string"
    && typeof value.projectPath === "string"
    && (value.symbolKind === "function"
      || value.symbolKind === "module"
      || value.symbolKind === "variable")
  );
}

export class OpenScadProjectIndexClient {
  private readonly fallbackCache = new OpenScadProjectIndexCache();
  private currentFileFallbackCache: {
    readonly documentPath: string;
    readonly query: string;
    readonly result: CurrentFileIndexResult;
    readonly source: string;
  } | null = null;
  private readonly factory: ProjectIndexWorkerFactory;
  private readonly pending = new Map<number, PendingRequest>();
  private worker: ProjectIndexWorkerLike | null = null;
  private workerDisabled: boolean;
  private disposed = false;
  private nextRequestId = 1;

  constructor(factory?: ProjectIndexWorkerFactory) {
    this.factory = factory ?? defaultWorkerFactory;
    this.workerDisabled = factory === undefined && typeof Worker === "undefined";
  }

  async index(
    input: IndexInput,
    signal: AbortSignal,
  ): Promise<readonly ProjectIndexedSymbol[]> {
    if (this.disposed || signal.aborted) throw abortError();
    const worker = this.ensureWorker();
    if (!worker) return this.indexWithFallback(input, signal);
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.delete(requestId)) return;
        signal.removeEventListener("abort", onAbort);
        try {
          worker.postMessage({ type: "cancel-project-index", requestId });
        } catch {
          // The request is already cancelled; worker shutdown is handled on the next operation.
        }
        reject(abortError());
      };
      const pending: PendingRequest = {
        input,
        kind: "project",
        signal,
        resolve: (result) => resolve(result as readonly ProjectIndexedSymbol[]),
        reject,
        onAbort,
      };
      this.pending.set(requestId, pending);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        worker.postMessage({
          type: "index-project",
          requestId,
          documentPath: input.documentPath,
          references: input.references,
        });
      } catch {
        this.failWorker();
      }
    });
  }

  async indexCurrentFile(
    input: CurrentFileIndexInput,
    signal: AbortSignal,
  ): Promise<CurrentFileIndexResult> {
    if (this.disposed || signal.aborted) throw abortError();
    if (input.source.length > MAX_PROJECT_INDEX_FILE_CODE_UNITS) {
      return { references: [], symbols: [] };
    }
    const worker = this.ensureWorker();
    if (!worker) return this.indexCurrentFileWithFallback(input, signal);
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.delete(requestId)) return;
        signal.removeEventListener("abort", onAbort);
        try {
          worker.postMessage({ type: "cancel-project-index", requestId });
        } catch {
          // The request is already cancelled; worker shutdown is handled on the next operation.
        }
        reject(abortError());
      };
      const pending: PendingRequest = {
        input,
        kind: "current-file",
        signal,
        resolve: (result) => resolve(result as CurrentFileIndexResult),
        reject,
        onAbort,
      };
      this.pending.set(requestId, pending);
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        worker.postMessage({
          type: "index-current-file",
          requestId,
          documentPath: input.documentPath,
          query: input.query,
          source: input.source,
        });
      } catch {
        this.failWorker();
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    for (const [requestId, request] of this.pending) {
      this.pending.delete(requestId);
      request.signal.removeEventListener("abort", request.onAbort);
      request.reject(abortError());
    }
  }

  private ensureWorker(): ProjectIndexWorkerLike | null {
    if (this.workerDisabled || this.disposed) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = this.factory();
      this.worker.onmessage = (event) => this.receiveWorkerMessage(event.data);
      this.worker.onerror = () => this.failWorker();
      return this.worker;
    } catch {
      this.workerDisabled = true;
      return null;
    }
  }

  private receiveWorkerMessage(value: unknown): void {
    if (!isRecord(value) || !Number.isSafeInteger(value.requestId)) {
      this.failWorker();
      return;
    }
    const requestId = value.requestId as number;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    if (value.type === "read-project-source" && typeof value.path === "string") {
      if (pending.kind !== "project") {
        this.failWorker();
        return;
      }
      let source: string | undefined;
      try {
        source = (pending.input as IndexInput).sources.get(value.path);
      } catch {
        source = undefined;
      }
      if (source !== undefined && source.length > MAX_PROJECT_INDEX_FILE_CODE_UNITS) {
        source = undefined;
      }
      try {
        this.worker?.postMessage({
          type: "project-source",
          requestId,
          path: value.path,
          source,
        });
      } catch {
        this.failWorker();
      }
      return;
    }
    if (value.type === "project-index-result" && Array.isArray(value.symbols)) {
      if (pending.kind !== "project") {
        this.failWorker();
        return;
      }
      if (!value.symbols.every(isProjectIndexedSymbol)) {
        this.failWorker();
        return;
      }
      this.finish(requestId, () => pending.resolve(value.symbols as ProjectIndexedSymbol[]));
      return;
    }
    if (
      value.type === "current-file-index-result"
      && Array.isArray(value.symbols)
      && value.symbols.every(isProjectIndexedSymbol)
      && Array.isArray(value.references)
      && value.references.every((reference) => (
        isRecord(reference)
        && (reference.kind === "include" || reference.kind === "use")
        && typeof reference.path === "string"
      ))
    ) {
      if (pending.kind !== "current-file") {
        this.failWorker();
        return;
      }
      this.finish(requestId, () => pending.resolve({
        references: value.references as unknown as ProjectReference[],
        symbols: value.symbols as ProjectIndexedSymbol[],
      }));
      return;
    }
    if (value.type === "project-index-error") {
      this.failWorker();
      return;
    }
    this.failWorker();
  }

  private finish(requestId: number, outcome: () => void): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.signal.removeEventListener("abort", pending.onAbort);
    outcome();
  }

  private failWorker(): void {
    const requests = [...this.pending.values()];
    this.pending.clear();
    for (const request of requests) {
      request.signal.removeEventListener("abort", request.onAbort);
    }
    this.disableWorker();
    for (const request of requests) {
      const fallback = request.kind === "current-file"
        ? this.indexCurrentFileWithFallback(request.input as CurrentFileIndexInput, request.signal)
        : this.indexWithFallback(request.input as IndexInput, request.signal);
      void fallback.then(
        request.resolve,
        request.reject,
      );
    }
  }

  private disableWorker(): void {
    this.workerDisabled = true;
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }

  private indexWithFallback(
    input: IndexInput,
    signal: AbortSignal,
  ): Promise<readonly ProjectIndexedSymbol[]> {
    return indexOpenScadProject({
      documentPath: input.documentPath,
      references: input.references,
      readSource: (path) => Promise.resolve(input.sources.get(path)),
      parseFile: parseProjectFileEventsCooperatively,
      cache: this.fallbackCache,
      isCancelled: () => this.disposed || signal.aborted,
    });
  }

  private indexCurrentFileWithFallback(
    input: CurrentFileIndexInput,
    signal: AbortSignal,
  ): Promise<CurrentFileIndexResult> {
    const cached = this.currentFileFallbackCache;
    if (
      cached?.documentPath === input.documentPath
      && cached.query === input.query
      && cached.source === input.source
    ) return Promise.resolve(cached.result);
    return indexOpenScadCurrentFileCooperatively(
      input.source,
      input.documentPath,
      input.query,
      () => this.disposed || signal.aborted,
    ).then((result) => {
      if (!this.disposed && !signal.aborted) {
        this.currentFileFallbackCache = { ...input, result };
      }
      return result;
    });
  }
}
