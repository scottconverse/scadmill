import type {
  EngineInfo,
  EngineOutputEvent,
  ExportRequest,
  ExportResult,
  ParamValue,
  RenderRequest,
  RenderResult,
} from "../application/engine/contracts";

export interface WasmProjectFile {
  readonly path: string;
  readonly contents: string | Uint8Array;
}

export interface WasmRenderRequest extends Omit<RenderRequest, "files" | "parameters"> {
  readonly files: readonly WasmProjectFile[];
  readonly parameters: Readonly<Record<string, ParamValue>>;
}

export interface WasmExportRequest extends Omit<ExportRequest, "files" | "parameters"> {
  readonly files: readonly WasmProjectFile[];
  readonly parameters: Readonly<Record<string, ParamValue>>;
}

export type WasmEngineWorkerRequest =
  | { readonly kind: "version"; readonly jobId: string }
  | { readonly kind: "render"; readonly jobId: string; readonly request: WasmRenderRequest }
  | { readonly kind: "export"; readonly jobId: string; readonly request: WasmExportRequest };

export type WasmEngineWorkerResponse =
  | { readonly kind: "output"; readonly jobId: string; readonly event: EngineOutputEvent }
  | { readonly kind: "version-result"; readonly jobId: string; readonly info: EngineInfo | null }
  | { readonly kind: "render-result"; readonly jobId: string; readonly result: RenderResult }
  | { readonly kind: "export-result"; readonly jobId: string; readonly result: ExportResult };

export interface WasmEngineWorkerLike {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: { readonly message?: string }) => void) | null;
  postMessage(message: WasmEngineWorkerRequest, transfer?: readonly Transferable[]): void;
  terminate(): void;
}

export type WasmEngineWorkerFactory = () => WasmEngineWorkerLike;

export interface WasmEngineWorkerPayload {
  readonly message: WasmEngineWorkerRequest;
  readonly transfer: readonly Transferable[];
}

function copyParameters(
  parameters: Readonly<Record<string, ParamValue>>,
): Readonly<Record<string, ParamValue>> {
  return Object.fromEntries(
    Object.entries(parameters).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.slice() : value,
    ]),
  );
}

function copyFiles(files: RenderRequest["files"]): {
  readonly files: readonly WasmProjectFile[];
  readonly transfer: readonly Transferable[];
} {
  const transfer: Transferable[] = [];
  const copied = [...files].map(([path, contents]) => {
    if (typeof contents === "string") return { path, contents };
    const bytes = contents.slice();
    transfer.push(bytes.buffer as ArrayBuffer);
    return { path, contents: bytes };
  });
  return { files: copied, transfer };
}

export function renderWorkerPayload(
  jobId: string,
  request: RenderRequest,
): WasmEngineWorkerPayload {
  const { files, parameters, ...rendering } = request;
  const copied = copyFiles(files);
  return {
    message: {
      kind: "render",
      jobId,
      request: {
        ...rendering,
        files: copied.files,
        parameters: copyParameters(parameters),
      },
    },
    transfer: copied.transfer,
  };
}

export function exportWorkerPayload(
  jobId: string,
  request: ExportRequest,
): WasmEngineWorkerPayload {
  const { files, parameters, image, ...exporting } = request;
  const copied = copyFiles(files);
  return {
    message: {
      kind: "export",
      jobId,
      request: {
        ...exporting,
        files: copied.files,
        parameters: copyParameters(parameters),
        ...(image
          ? {
              image: {
                ...image,
                ...(image.camera
                  ? {
                      camera: {
                        position: [...image.camera.position],
                        target: [...image.camera.target],
                        up: [...image.camera.up],
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
    },
    transfer: copied.transfer,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    ["error", "warning", "echo", "trace", "info"].includes(String(value.severity))
    && typeof value.message === "string"
    && isOptionalString(value.file)
    && (value.line === undefined || (Number.isSafeInteger(value.line) && Number(value.line) > 0))
  );
}

function hasRunOutput(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.diagnostics)
    && value.diagnostics.every(isDiagnostic)
    && typeof value.rawLog === "string"
  );
}

function isBounds(value: unknown, dimensions: 2 | 3): boolean {
  if (!isRecord(value)) return false;
  const minimum = value.min;
  const maximum = value.max;
  return (
    isFiniteTuple(minimum, dimensions)
    && isFiniteTuple(maximum, dimensions)
    && minimum.every((coordinate, axis) => coordinate <= maximum[axis])
  );
}

function isOptionalNonnegativeNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isRenderStats(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.engineTimeMs === "number"
    && Number.isFinite(value.engineTimeMs)
    && value.engineTimeMs >= 0
    && isOptionalNonnegativeNumber(value.vertices)
    && isOptionalNonnegativeNumber(value.triangles)
    && isOptionalNonnegativeNumber(value.volumeMm3)
    && (value.boundingBox === undefined || isBounds(value.boundingBox, 3))
  );
}

function isRenderResult(value: unknown): value is RenderResult {
  if (!isRecord(value) || !hasRunOutput(value)) return false;
  if (value.kind === "failure") {
    return (
      ["engine-error", "timeout", "cancelled", "engine-missing"].includes(String(value.reason))
      && (value.exitCode === undefined || Number.isInteger(value.exitCode))
    );
  }
  if (value.kind === "2d") {
    return typeof value.svg === "string" && isBounds(value.boundingBox, 2);
  }
  if (value.kind !== "3d" || !isRecord(value.mesh)) return false;
  return (
    ["stl-binary", "stl-ascii", "3mf", "off", "amf"].includes(String(value.mesh.format))
    && value.mesh.bytes instanceof Uint8Array
    && isOptionalString(value.mesh.geometryIdentity)
    && isRenderStats(value.stats)
  );
}

function isExportResult(value: unknown): value is ExportResult {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !hasRunOutput(value)) return false;
  return (
    (value.ok ? value.bytes instanceof Uint8Array : value.bytes === undefined || value.bytes instanceof Uint8Array)
    && isOptionalString(value.fileExtension)
  );
}

function isEngineInfo(value: unknown): value is EngineInfo {
  return (
    isRecord(value)
    && typeof value.version === "string"
    && value.path === "wasm"
    && Array.isArray(value.features)
    && value.features.every((feature) => typeof feature === "string")
  );
}

function isOutputEvent(value: unknown): value is EngineOutputEvent {
  return (
    isRecord(value)
    && Number.isSafeInteger(value.sequence)
    && Number(value.sequence) >= 0
    && typeof value.elapsedMs === "number"
    && Number.isFinite(value.elapsedMs)
    && value.elapsedMs >= 0
    && (value.stream === "stdout" || value.stream === "stderr")
    && typeof value.raw === "string"
  );
}

export function decodeWasmEngineWorkerResponse(
  value: unknown,
): WasmEngineWorkerResponse | null {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.jobId !== "string") {
    return null;
  }
  if (value.kind === "output" && isOutputEvent(value.event)) {
    return value as unknown as WasmEngineWorkerResponse;
  }
  if (value.kind === "version-result" && (value.info === null || isEngineInfo(value.info))) {
    return value as unknown as WasmEngineWorkerResponse;
  }
  if (value.kind === "render-result" && isRenderResult(value.result)) {
    return value as unknown as WasmEngineWorkerResponse;
  }
  if (value.kind === "export-result" && isExportResult(value.result)) {
    return value as unknown as WasmEngineWorkerResponse;
  }
  return null;
}
