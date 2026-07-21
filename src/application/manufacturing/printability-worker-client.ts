import {
  analyzePrintability,
  type PrintabilityConfiguration,
  type PrintabilityReport,
} from "./printability";

interface WorkerMessageEvent { readonly data: unknown }
export interface PrintabilityWorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: { readonly bytes: ArrayBuffer; readonly configuration: PrintabilityConfiguration }, transfer: readonly Transferable[]): void;
  terminate(): void;
}
export type PrintabilityWorkerFactory = () => PrintabilityWorkerLike;

const MAX_MAIN_THREAD_BYTES = 1024 * 1024;

function defaultWorkerFactory(): PrintabilityWorkerLike {
  return new Worker(new URL("./printability.worker.ts", import.meta.url), { type: "module" }) as unknown as PrintabilityWorkerLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function point(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function decodeReport(value: unknown): PrintabilityReport {
  if (!isRecord(value) || !exactKeys(value, ["manifold", "buildVolume", "minimumFeature", "overhangs"])) {
    throw new Error("The printability worker returned an invalid response.");
  }
  const manifold = value.manifold;
  const buildVolume = value.buildVolume;
  const feature = value.minimumFeature;
  const overhangs = value.overhangs;
  if (!isRecord(manifold) || !exactKeys(manifold, ["status", "boundaryEdges", "nonManifoldEdges"])
    || !["pass", "fail"].includes(manifold.status as string)
    || !Number.isSafeInteger(manifold.boundaryEdges) || (manifold.boundaryEdges as number) < 0
    || !Number.isSafeInteger(manifold.nonManifoldEdges) || (manifold.nonManifoldEdges as number) < 0
    || !isRecord(buildVolume) || !exactKeys(buildVolume, ["status", "modelSizeMm", "configuredMm"])
    || !["pass", "fail"].includes(buildVolume.status as string)
    || !point(buildVolume.modelSizeMm) || !point(buildVolume.configuredMm)
    || !isRecord(feature) || typeof feature.status !== "string"
    || !isRecord(overhangs) || !exactKeys(overhangs, ["status"]) || overhangs.status !== "not-checked") {
    throw new Error("The printability worker returned an invalid response.");
  }
  const validFeature = feature.status === "pass"
    ? exactKeys(feature, ["status", "nozzleDiameterMm"])
      && typeof feature.nozzleDiameterMm === "number" && Number.isFinite(feature.nozzleDiameterMm)
    : feature.status === "warning"
      ? exactKeys(feature, ["status", "detectedMm", "nozzleDiameterMm"])
        && typeof feature.detectedMm === "number" && Number.isFinite(feature.detectedMm)
        && typeof feature.nozzleDiameterMm === "number" && Number.isFinite(feature.nozzleDiameterMm)
      : feature.status === "not-checked"
        && exactKeys(feature, ["status", "reason"])
        && typeof feature.reason === "string" && feature.reason.length > 0;
  if (!validFeature) throw new Error("The printability worker returned an invalid response.");
  return value as unknown as PrintabilityReport;
}

function abortError(): Error {
  const error = new Error("The printability check was aborted.");
  error.name = "AbortError";
  return error;
}

export function runPrintabilityOffThread(
  bytes: Uint8Array,
  configuration: PrintabilityConfiguration,
  factory?: PrintabilityWorkerFactory,
  signal?: AbortSignal,
): Promise<PrintabilityReport> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (!factory && typeof Worker === "undefined") {
    if (bytes.byteLength > MAX_MAIN_THREAD_BYTES) {
      return Promise.reject(new Error("The mesh is too large to check without Web Worker support."));
    }
    const copy = bytes.slice();
    return Promise.resolve().then(() => analyzePrintability(copy, configuration));
  }
  return new Promise((resolve, reject) => {
    let worker: PrintabilityWorkerLike;
    try { worker = (factory ?? defaultWorkerFactory)(); } catch { reject(new Error("The printability worker could not start.")); return; }
    let settled = false;
    const finish = (outcome: () => PrintabilityReport) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null; worker.onerror = null; worker.terminate();
      try { resolve(outcome()); } catch (error) { reject(error); }
    };
    const onAbort = () => finish(() => { throw abortError(); });
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.onmessage = ({ data }) => finish(() => {
      if (!isRecord(data)) throw new Error("The printability worker returned an invalid response.");
      if (data.ok === false && typeof data.error === "string") throw new Error(data.error);
      if (data.ok !== true) throw new Error("The printability worker returned an invalid response.");
      return decodeReport(data.report);
    });
    worker.onerror = (event) => finish(() => { throw new Error(event.message || "The printability worker failed."); });
    const copy = bytes.slice();
    try { worker.postMessage({ bytes: copy.buffer, configuration }, [copy.buffer]); }
    catch { finish(() => { throw new Error("The printability worker could not start."); }); }
  });
}
