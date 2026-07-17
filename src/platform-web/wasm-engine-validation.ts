import type {
  EngineInfo,
  EngineOutputEvent,
  ExportResult,
  ParamValue,
  RenderResult,
} from "../application/engine/contracts";
import type {
  WasmEngineLoadProgress,
  WasmEngineWorkerRequest,
  WasmEngineWorkerResponse,
  WasmExportRequest,
  WasmProjectFile,
  WasmRenderRequest,
} from "./wasm-engine-protocol";

type RecordValue = Record<string, unknown>;

function plain(value: unknown): value is RecordValue {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exact(value: RecordValue, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => typeof key === "string" && (required.includes(key) || optional.includes(key)))
  );
}

function dense<T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
  length?: number,
): value is T[] {
  if (
    !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || (length !== undefined && value.length !== length)
  ) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !predicate(value[index])) return false;
  }
  return Reflect.ownKeys(value).every((key) => {
    if (key === "length") return true;
    if (typeof key !== "string" || key === "") return false;
    const index = Number(key);
    return Number.isSafeInteger(index) && index >= 0 && index < value.length && String(index) === key;
  });
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonnegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function jobId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function tuple(value: unknown, length: number): value is number[] {
  return dense(value, finite, length);
}

function param(value: unknown): value is ParamValue {
  return (
    typeof value === "string"
    || typeof value === "boolean"
    || finite(value)
    || dense(value, finite)
  );
}

function parameters(value: unknown): value is Readonly<Record<string, ParamValue>> {
  return plain(value) && Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && param(value[key]),
  );
}

function projectFile(value: unknown): value is WasmProjectFile {
  return (
    plain(value)
    && exact(value, ["path", "contents"])
    && typeof value.path === "string"
    && (typeof value.contents === "string" || value.contents instanceof Uint8Array)
  );
}

function renderFields(value: RecordValue): boolean {
  return (
    typeof value.entryFile === "string"
    && dense(value.files, projectFile)
    && parameters(value.parameters)
    && (value.quality === "preview" || value.quality === "full")
    && nonnegative(value.timeoutMs)
    && (value.previewFacetLimit === undefined
      || (Number.isSafeInteger(value.previewFacetLimit)
        && Number(value.previewFacetLimit) >= 0
        && Number(value.previewFacetLimit) <= 0xffff_ffff))
  );
}

function renderRequest(value: unknown): value is WasmRenderRequest {
  return (
    plain(value)
    && exact(value, ["entryFile", "files", "parameters", "quality", "timeoutMs"], ["previewFacetLimit"])
    && renderFields(value)
  );
}

function image(value: unknown): boolean {
  if (!plain(value) || !exact(value, ["width", "height"], ["camera"])) return false;
  if (!Number.isSafeInteger(value.width) || Number(value.width) <= 0) return false;
  if (!Number.isSafeInteger(value.height) || Number(value.height) <= 0) return false;
  if (value.camera === undefined) return true;
  return (
    plain(value.camera)
    && exact(value.camera, ["position", "target", "up"])
    && tuple(value.camera.position, 3)
    && tuple(value.camera.target, 3)
    && tuple(value.camera.up, 3)
  );
}

function exportRequest(value: unknown): value is WasmExportRequest {
  return (
    plain(value)
    && exact(value, ["entryFile", "files", "parameters", "timeoutMs", "format"], ["previewFacetLimit", "image"])
    && renderFields({ ...value, quality: "full" })
    && ["stl-binary", "stl-ascii", "3mf", "off", "amf", "svg", "dxf", "png"].includes(String(value.format))
    && (value.image === undefined || image(value.image))
  );
}

export function decodeWasmEngineWorkerRequest(value: unknown): WasmEngineWorkerRequest | null {
  if (!plain(value) || !jobId(value.jobId) || typeof value.kind !== "string") return null;
  if (value.kind === "version" && exact(value, ["kind", "jobId"])) return value as unknown as WasmEngineWorkerRequest;
  if (value.kind === "render" && exact(value, ["kind", "jobId", "request"]) && renderRequest(value.request)) {
    return value as unknown as WasmEngineWorkerRequest;
  }
  if (value.kind === "export" && exact(value, ["kind", "jobId", "request"]) && exportRequest(value.request)) {
    return value as unknown as WasmEngineWorkerRequest;
  }
  return null;
}

function diagnostic(value: unknown): value is RecordValue {
  return (
    plain(value)
    && exact(value, ["severity", "message"], ["file", "line"])
    && ["error", "warning", "echo", "trace", "info"].includes(String(value.severity))
    && typeof value.message === "string"
    && (value.file === undefined || typeof value.file === "string")
    && (value.line === undefined || (Number.isSafeInteger(value.line) && Number(value.line) > 0))
  );
}

function runOutput(value: RecordValue): boolean {
  return dense(value.diagnostics, diagnostic) && typeof value.rawLog === "string";
}

function bounds(value: unknown, dimensions: 2 | 3): boolean {
  if (!plain(value) || !exact(value, ["min", "max"])) return false;
  const minimum = value.min;
  const maximum = value.max;
  return (
    tuple(minimum, dimensions)
    && tuple(maximum, dimensions)
    && minimum.every((coordinate, axis) => coordinate <= maximum[axis])
  );
}

function renderStats(value: unknown): boolean {
  return (
    plain(value)
    && exact(value, ["engineTimeMs"], ["vertices", "triangles", "boundingBox", "volumeMm3"])
    && nonnegative(value.engineTimeMs)
    && [value.vertices, value.triangles, value.volumeMm3].every(
      (item) => item === undefined || nonnegative(item),
    )
    && (value.boundingBox === undefined || bounds(value.boundingBox, 3))
  );
}

function renderResult(value: unknown): value is RenderResult {
  if (!plain(value) || !runOutput(value)) return false;
  if (value.kind === "failure") {
    return (
      exact(value, ["kind", "reason", "diagnostics", "rawLog"], ["exitCode"])
      && ["engine-error", "timeout", "cancelled", "engine-missing"].includes(String(value.reason))
      && (value.exitCode === undefined || Number.isInteger(value.exitCode))
    );
  }
  if (value.kind === "2d") {
    return exact(value, ["kind", "svg", "boundingBox", "diagnostics", "rawLog"])
      && typeof value.svg === "string" && bounds(value.boundingBox, 2);
  }
  if (value.kind !== "3d" || !plain(value.mesh)) return false;
  return (
    exact(value, ["kind", "mesh", "stats", "diagnostics", "rawLog"])
    && exact(value.mesh, ["format", "bytes"], ["geometryIdentity"])
    && ["stl-binary", "stl-ascii", "3mf", "off", "amf"].includes(String(value.mesh.format))
    && value.mesh.bytes instanceof Uint8Array
    && (value.mesh.geometryIdentity === undefined || typeof value.mesh.geometryIdentity === "string")
    && renderStats(value.stats)
  );
}

function exportResult(value: unknown): value is ExportResult {
  return (
    plain(value)
    && exact(value, ["ok", "diagnostics", "rawLog"], ["bytes", "fileExtension"])
    && typeof value.ok === "boolean"
    && runOutput(value)
    && (value.ok ? value.bytes instanceof Uint8Array : value.bytes === undefined || value.bytes instanceof Uint8Array)
    && (value.fileExtension === undefined || typeof value.fileExtension === "string")
  );
}

function engineInfo(value: unknown): value is EngineInfo {
  return (
    plain(value)
    && exact(value, ["version", "path", "features"])
    && typeof value.version === "string"
    && value.path === "wasm"
    && dense(value.features, (feature): feature is string => typeof feature === "string")
  );
}

function outputEvent(value: unknown): value is EngineOutputEvent {
  return (
    plain(value)
    && exact(value, ["sequence", "elapsedMs", "stream", "raw"])
    && Number.isSafeInteger(value.sequence)
    && Number(value.sequence) >= 0
    && nonnegative(value.elapsedMs)
    && (value.stream === "stdout" || value.stream === "stderr")
    && typeof value.raw === "string"
  );
}

function progress(value: unknown): value is WasmEngineLoadProgress {
  return (
    plain(value)
    && exact(value, ["asset", "loadedBytes", "totalBytes"])
    && (value.asset === "openscad.js" || value.asset === "openscad.wasm")
    && Number.isSafeInteger(value.loadedBytes)
    && Number(value.loadedBytes) >= 0
    && (value.totalBytes === null
      || (Number.isSafeInteger(value.totalBytes) && Number(value.totalBytes) >= Number(value.loadedBytes)))
  );
}

export function decodeWasmEngineWorkerResponse(value: unknown): WasmEngineWorkerResponse | null {
  if (!plain(value) || !jobId(value.jobId) || typeof value.kind !== "string") return null;
  const exactEnvelope = (payload: string) => exact(value, ["kind", "jobId", payload]);
  if (value.kind === "progress" && exactEnvelope("progress") && progress(value.progress)) return value as unknown as WasmEngineWorkerResponse;
  if (value.kind === "output" && exactEnvelope("event") && outputEvent(value.event)) return value as unknown as WasmEngineWorkerResponse;
  if (value.kind === "version-result" && exactEnvelope("info") && (value.info === null || engineInfo(value.info))) return value as unknown as WasmEngineWorkerResponse;
  if (value.kind === "render-result" && exactEnvelope("result") && renderResult(value.result)) return value as unknown as WasmEngineWorkerResponse;
  if (value.kind === "export-result" && exactEnvelope("result") && exportResult(value.result)) return value as unknown as WasmEngineWorkerResponse;
  return null;
}
