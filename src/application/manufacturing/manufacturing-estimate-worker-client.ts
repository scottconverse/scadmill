import type { MeshFormat } from "../engine/contracts";

interface WorkerMessageEvent { readonly data: unknown }

export interface ManufacturingEstimateWorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: {
    readonly bytes: ArrayBuffer;
    readonly format: MeshFormat;
  }, transfer: readonly Transferable[]): void;
  terminate(): void;
}

export type ManufacturingEstimateWorkerFactory = () => ManufacturingEstimateWorkerLike;

const MAX_ESTIMATE_INPUT_BYTES = 512 * 1024 * 1024;

function abortError(): Error {
  const error = new Error("The manufacturing estimate was cancelled.");
  error.name = "AbortError";
  return error;
}

function defaultWorkerFactory(): ManufacturingEstimateWorkerLike {
  return new Worker(
    new URL("./manufacturing-estimate.worker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as ManufacturingEstimateWorkerLike;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function prepareManufacturingEstimateStlOffThread(
  bytes: Uint8Array,
  format: MeshFormat,
  factory?: ManufacturingEstimateWorkerFactory,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (format !== "stl-binary" && format !== "3mf") {
    return Promise.reject(new Error("Manufacturing estimates require binary STL or 3MF geometry."));
  }
  if (bytes.byteLength > MAX_ESTIMATE_INPUT_BYTES) {
    return Promise.reject(new Error("The model is too large to estimate."));
  }
  return new Promise((resolve, reject) => {
    let worker: ManufacturingEstimateWorkerLike;
    try {
      worker = (factory ?? defaultWorkerFactory)();
    } catch {
      reject(new Error("The manufacturing estimate worker could not start."));
      return;
    }
    let settled = false;
    const finish = (outcome: () => Uint8Array) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      try { resolve(outcome()); } catch (error) { reject(error); }
    };
    const onAbort = () => finish(() => { throw abortError(); });
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = ({ data }) => finish(() => {
      if (!record(data)) throw new Error("The manufacturing estimate worker returned an invalid response.");
      if (data.ok === false && typeof data.error === "string" && data.error.length > 0) {
        throw new Error(data.error);
      }
      if (
        data.ok !== true
        || Object.keys(data).length !== 2
        || !(data.stl instanceof ArrayBuffer)
        || data.stl.byteLength === 0
      ) throw new Error("The manufacturing estimate worker returned an invalid response.");
      return new Uint8Array(data.stl);
    });
    worker.onerror = (event) => finish(() => {
      throw new Error(event.message || "The manufacturing estimate worker failed.");
    });
    const copy = bytes.slice();
    try {
      worker.postMessage({ bytes: copy.buffer, format }, [copy.buffer]);
    } catch {
      finish(() => { throw new Error("The manufacturing estimate worker could not start."); });
    }
  });
}
