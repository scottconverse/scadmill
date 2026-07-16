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

export interface WasmEngineLoadProgress {
  readonly asset: "openscad.js" | "openscad.wasm";
  readonly loadedBytes: number;
  readonly totalBytes: number | null;
}

export type WasmEngineWorkerResponse =
  | { readonly kind: "progress"; readonly jobId: string; readonly progress: WasmEngineLoadProgress }
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

export {
  decodeWasmEngineWorkerRequest,
  decodeWasmEngineWorkerResponse,
} from "./wasm-engine-validation";
