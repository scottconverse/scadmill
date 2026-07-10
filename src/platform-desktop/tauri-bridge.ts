import { invoke } from "@tauri-apps/api/core";

import type { NativeEngineBridge } from "../application/engine/native-engine-service";

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface NativeRenderWireResponse {
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

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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
      });
      return {
        kind: "3d",
        mesh: { format: response.format, bytes: decodeBase64(response.meshBase64) },
        stats: {
          triangles: response.triangleCount,
          boundingBox: { min: response.bounds.min, max: response.bounds.max },
          engineTimeMs: response.engineTimeMs,
        },
        diagnostics: [],
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
