interface WorkerMessageEvent {
  readonly data: unknown;
}

export interface ThreeMfCanonicalizerWorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: { readonly bytes: ArrayBuffer }, transfer: readonly Transferable[]): void;
  terminate(): void;
}

export type ThreeMfCanonicalizerWorkerFactory = () => ThreeMfCanonicalizerWorkerLike;

const MAX_MAIN_THREAD_ARCHIVE_BYTES = 1024 * 1024;
const MAX_MAIN_THREAD_MODEL_BYTES = 8 * 1024 * 1024;
const WORKER_START_ERROR = "The 3MF geometry canonicalizer worker could not start.";

function defaultWorkerFactory(): ThreeMfCanonicalizerWorkerLike {
  return new Worker(
    new URL("./three-mf-canonicalizer.worker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as ThreeMfCanonicalizerWorkerLike;
}

function decodeResponse(value: unknown): Uint8Array {
  if (!value || typeof value !== "object") {
    throw new Error("The 3MF geometry canonicalizer worker returned an invalid response.");
  }
  const response = value as Record<string, unknown>;
  if (response.ok === false && typeof response.error === "string") throw new Error(response.error);
  if (response.ok !== true || !(response.bytes instanceof ArrayBuffer) || response.bytes.byteLength === 0) {
    throw new Error("The 3MF geometry canonicalizer worker returned an invalid response.");
  }
  return new Uint8Array(response.bytes);
}

export function canonicalThreeMfGeometryBytesOffThread(
  bytes: Uint8Array,
  suppliedFactory?: ThreeMfCanonicalizerWorkerFactory,
): Promise<Uint8Array> {
  const factory = suppliedFactory ?? (typeof Worker === "undefined" ? undefined : defaultWorkerFactory);
  if (!factory) {
    if (bytes.byteLength > MAX_MAIN_THREAD_ARCHIVE_BYTES) {
      return Promise.reject(new Error("The 3MF model is too large to canonicalize without Web Worker support."));
    }
    return import("./three-mf").then(({ canonicalThreeMfGeometryBytes }) =>
      canonicalThreeMfGeometryBytes(bytes.slice(), MAX_MAIN_THREAD_MODEL_BYTES)
    );
  }
  return new Promise((resolve, reject) => {
    let worker: ThreeMfCanonicalizerWorkerLike;
    try {
      worker = factory();
    } catch {
      reject(new Error(WORKER_START_ERROR));
      return;
    }
    let settled = false;
    const finish = (outcome: () => Uint8Array) => {
      if (settled) return;
      settled = true;
      try {
        resolve(outcome());
      } catch (error) {
        reject(error);
      } finally {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
    };
    worker.onmessage = (event) => finish(() => decodeResponse(event.data));
    worker.onerror = (event) => finish(() => {
      throw new Error(event.message || "The 3MF geometry canonicalizer worker failed.");
    });
    const copy = bytes.slice();
    try {
      worker.postMessage({ bytes: copy.buffer }, [copy.buffer]);
    } catch {
      finish(() => { throw new Error(WORKER_START_ERROR); });
    }
  });
}
