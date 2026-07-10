import { invoke } from "@tauri-apps/api/core";

import { parseEngineLog } from "../application/diagnostics/parse-engine-log";
import type { NativeEngineBridge } from "../application/engine/native-engine-service";

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface NativeRenderSuccessWireResponse {
  kind: "3d";
  format: "stl-binary";
  meshBase64: string;
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  rawLog: string;
  engineTimeMs: number;
}

interface NativeRenderFailureWireResponse {
  kind: "failure";
  reason: "engine-error" | "timeout" | "cancelled" | "engine-missing";
  exitCode?: number | null;
  rawLog: string;
}

type NativeRenderWireResponse = NativeRenderSuccessWireResponse | NativeRenderFailureWireResponse;

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function nativeDiagnostics(rawLog: string, entryFile: string) {
  return parseEngineLog(rawLog, {
    resolveFile: (reportedFile) => reportedFile === "main.scad" ? entryFile : reportedFile,
  }).diagnostics;
}

export function createTauriBridge(invokeCommand: Invoke = invoke): NativeEngineBridge {
  return {
    render: async (_jobId, request) => {
      const source = request.files.get(request.entryFile);
      if (typeof source !== "string") {
        throw new Error(`The entry document ${request.entryFile} is missing or is not UTF-8 text.`);
      }
      const response = await invokeCommand<NativeRenderWireResponse>("render_native", {
        source,
        quality: request.quality,
        parameters: request.parameters,
      });
      if (response.kind === "failure") {
        return {
          kind: "failure",
          reason: response.reason,
          ...(typeof response.exitCode === "number" ? { exitCode: response.exitCode } : {}),
          diagnostics: nativeDiagnostics(response.rawLog, request.entryFile),
          rawLog: response.rawLog,
        };
      }
      const diagnostics = nativeDiagnostics(response.rawLog, request.entryFile);
      return {
        kind: "3d",
        mesh: { format: response.format, bytes: decodeBase64(response.meshBase64) },
        stats: {
          triangles: response.triangleCount,
          boundingBox: { min: response.bounds.min, max: response.bounds.max },
          engineTimeMs: response.engineTimeMs,
        },
        diagnostics,
        rawLog: response.rawLog,
      };
    },
    export: async () => {
      throw new Error("Native export is not available before M2.");
    },
    version: async () => ({
      version: await invokeCommand<string>("native_engine_version"),
      path: "native",
      features: [],
    }),
    cancel: () => undefined,
  };
}
