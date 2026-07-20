import { parseBinaryStl, type ParsedBinaryStl } from "./stl";

interface WorkerMessageEvent {
  readonly data: unknown;
}

export interface StlParserWorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: { readonly bytes: ArrayBuffer }, transfer: readonly Transferable[]): void;
  terminate(): void;
}

export type StlParserWorkerFactory = () => StlParserWorkerLike;

export interface ReusableBinaryStlParser {
  parse(bytes: Uint8Array, signal?: AbortSignal): Promise<ParsedBinaryStl>;
  dispose(): void;
}

const MAX_MAIN_THREAD_STL_BYTES = 1024 * 1024;
const MAIN_THREAD_LIMIT_ERROR = "The model is too large to display without Web Worker support.";
const WORKER_START_ERROR = "The STL parser worker could not start.";

function abortError(): Error {
  const error = new Error("STL parsing was aborted.");
  error.name = "AbortError";
  return error;
}

function defaultWorkerFactory(): StlParserWorkerLike {
  return new Worker(
    new URL("./stl-parser.worker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as StlParserWorkerLike;
}

function isPoint(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function decodedWorkerResult(value: unknown): ParsedBinaryStl {
  if (typeof value !== "object" || value === null) {
    throw new Error("The STL parser worker returned an invalid response.");
  }
  const response = value as Record<string, unknown>;
  if (response.ok === false && typeof response.error === "string") throw new Error(response.error);
  if (
    response.ok !== true
    || !Number.isSafeInteger(response.triangleCount)
    || (response.triangleCount as number) <= 0
    || !(response.positions instanceof ArrayBuffer)
    || !(response.normals instanceof ArrayBuffer)
    || typeof response.bounds !== "object"
    || response.bounds === null
  ) throw new Error("The STL parser worker returned an invalid response.");
  const triangleCount = response.triangleCount as number;
  const expectedBytes = triangleCount * 9 * Float32Array.BYTES_PER_ELEMENT;
  const bounds = response.bounds as Record<string, unknown>;
  const minimum = bounds.min;
  const maximum = bounds.max;
  const size = bounds.size;
  if (
    response.positions.byteLength !== expectedBytes
    || response.normals.byteLength !== expectedBytes
    || !isPoint(minimum)
    || !isPoint(maximum)
    || !isPoint(size)
    || minimum.some((coordinate, axis) => coordinate > maximum[axis])
    || size.some((length, axis) => length !== maximum[axis] - minimum[axis])
  ) throw new Error("The STL parser worker returned an invalid response.");
  return {
    triangleCount,
    positions: new Float32Array(response.positions),
    normals: new Float32Array(response.normals),
    bounds: { min: minimum, max: maximum, size },
  };
}

export function parseBinaryStlOffThread(
  bytes: Uint8Array,
  factory?: StlParserWorkerFactory,
  signal?: AbortSignal,
): Promise<ParsedBinaryStl> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (!factory && typeof Worker === "undefined") {
    if (bytes.byteLength > MAX_MAIN_THREAD_STL_BYTES) {
      return Promise.reject(new Error(MAIN_THREAD_LIMIT_ERROR));
    }
    const copy = bytes.slice();
    return Promise.resolve().then(() => {
      if (signal?.aborted) throw abortError();
      return parseBinaryStl(copy);
    });
  }
  return new Promise((resolve, reject) => {
    let worker: StlParserWorkerLike;
    try {
      worker = (factory ?? defaultWorkerFactory)();
    } catch {
      reject(new Error(WORKER_START_ERROR));
      return;
    }
    let settled = false;
    const onAbort = () => finish(() => { throw abortError(); });
    const finish = (outcome: () => ParsedBinaryStl) => {
      if (settled) return;
      settled = true;
      try {
        resolve(outcome());
      } catch (error) {
        reject(error);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = (event) => finish(() => decodedWorkerResult(event.data));
    worker.onerror = (event) => finish(() => {
      throw new Error(event.message || "The STL parser worker failed.");
    });
    const copy = bytes.slice();
    try {
      worker.postMessage({ bytes: copy.buffer }, [copy.buffer]);
    } catch {
      finish(() => { throw new Error(WORKER_START_ERROR); });
    }
  });
}

export function createReusableBinaryStlParser(
  suppliedFactory?: StlParserWorkerFactory,
): ReusableBinaryStlParser {
  const factory = suppliedFactory
    ?? (typeof Worker === "undefined" ? undefined : defaultWorkerFactory);
  if (!factory) {
    let disposed = false;
    return {
      parse(bytes, signal) {
        return disposed
          ? Promise.reject(new Error("The STL parser has been disposed."))
          : parseBinaryStlOffThread(bytes, undefined, signal);
      },
      dispose() { disposed = true; },
    };
  }

  let worker: StlParserWorkerLike | undefined;
  let cancelActive: (() => void) | undefined;
  let disposed = false;
  const retire = (candidate: StlParserWorkerLike) => {
    candidate.onmessage = null;
    candidate.onerror = null;
    candidate.terminate();
    if (worker === candidate) worker = undefined;
  };

  return {
    parse(bytes, signal) {
      if (disposed) return Promise.reject(new Error("The STL parser has been disposed."));
      if (signal?.aborted) return Promise.reject(abortError());
      if (cancelActive) return Promise.reject(new Error("The STL parser is already parsing."));
      try {
        worker ??= factory();
      } catch {
        return Promise.reject(new Error(WORKER_START_ERROR));
      }
      const activeWorker = worker;
      return new Promise((resolve, reject) => {
        let settled = false;
        const clear = (retireWorker: boolean) => {
          signal?.removeEventListener("abort", onAbort);
          activeWorker.onmessage = null;
          activeWorker.onerror = null;
          cancelActive = undefined;
          if (retireWorker) retire(activeWorker);
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          clear(true);
          reject(error);
        };
        const onAbort = () => fail(abortError());
        cancelActive = onAbort;
        signal?.addEventListener("abort", onAbort, { once: true });
        activeWorker.onmessage = (event) => {
          if (settled) return;
          try {
            const parsed = decodedWorkerResult(event.data);
            settled = true;
            clear(false);
            resolve(parsed);
          } catch (error) {
            fail(error instanceof Error ? error : new Error("The STL parser worker failed."));
          }
        };
        activeWorker.onerror = (event) => fail(
          new Error(event.message || "The STL parser worker failed."),
        );
        const copy = bytes.slice();
        try {
          activeWorker.postMessage({ bytes: copy.buffer }, [copy.buffer]);
        } catch {
          fail(new Error(WORKER_START_ERROR));
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelActive?.();
      if (worker) retire(worker);
    },
  };
}
