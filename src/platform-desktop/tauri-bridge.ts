import { Channel, invoke } from "@tauri-apps/api/core";

import { parseEngineLog } from "../application/diagnostics/parse-engine-log";
import type {
  EngineOutputEvent,
  RenderRequest,
} from "../application/engine/contracts";
import type { NativeEngineBridge } from "../application/engine/native-engine-service";
import { closedMeshVolumeMm3 } from "../application/geometry/stl";
import { parseBinaryStlOffThread } from "../application/geometry/stl-parser-worker-client";

export type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type OutputChannelFactory = (
  onMessage: (event: EngineOutputEvent) => void,
) => unknown;

interface NativeRenderSuccess3DWireResponse {
  kind: "3d";
  format: "stl-binary" | "3mf";
  meshBase64: string;
  triangleCount?: number;
  volumeMm3?: number;
  bounds?: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  rawLog: string;
  engineTimeMs: number;
}

interface NativeRenderSuccess2DWireResponse {
  kind: "2d";
  svg: string;
  bounds: { min: [number, number]; max: [number, number] };
  rawLog: string;
}

interface NativeEngineVersionWireResponse {
  version: string;
  buildIdentity: string;
}

interface NativeRenderFailureWireResponse {
  kind: "failure";
  reason: "engine-error" | "timeout" | "cancelled" | "engine-missing";
  exitCode?: number | null;
  rawLog: string;
}

type NativeRenderWireResponse =
  | NativeRenderSuccess3DWireResponse
  | NativeRenderSuccess2DWireResponse
  | NativeRenderFailureWireResponse;

interface NativeExportWireResponse {
  ok: boolean;
  artifactBase64?: string;
  fileExtension?: string;
  rawLog: string;
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function wireFiles(request: RenderRequest) {
  return [...request.files].map(([path, contents]) => {
    const text = typeof contents === "string";
    const bytes = text ? new TextEncoder().encode(contents) : contents;
    return { path, text, contentsBase64: encodeBase64(bytes) };
  });
}

type ProjectRequest = Pick<RenderRequest, "entryFile" | "files">;

function resolveDiagnosticFile(reportedFile: string, request: ProjectRequest): string {
  const normalized = reportedFile.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (request.files.has(normalized)) return normalized;
  const suffixMatches = [...request.files.keys()].filter((path) =>
    normalized.endsWith(`/${path}`) || path.endsWith(`/${normalized}`)
  );
  return suffixMatches.length === 1 ? suffixMatches[0] : normalized;
}

function nativeDiagnostics(rawLog: string, request: ProjectRequest) {
  return parseEngineLog(rawLog, {
    resolveFile: (reportedFile) => resolveDiagnosticFile(reportedFile, request),
  }).diagnostics;
}

function reportedStatistic(rawLog: string, label: string): number | undefined {
  const match = new RegExp(`(?:^|\\n)\\s*${label}:\\s*([0-9]+(?:\\.[0-9]+)?)`, "iu")
    .exec(rawLog);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function renderArguments(
  jobId: string,
  request: RenderRequest,
  onOutput: unknown,
  configuredEnginePath: () => string | null,
) {
  const configuredPath = configuredEnginePath()?.trim();
  return {
    jobId,
    entryFile: request.entryFile,
    files: wireFiles(request),
    quality: request.quality,
    parameters: request.parameters,
    previewFacetLimit: request.quality === "preview" ? request.previewFacetLimit ?? 48 : null,
    timeoutMs: request.timeoutMs,
    onOutput,
    ...(configuredPath ? { configuredEnginePath: configuredPath } : {}),
    ...(request.engineVersion ? { requiredEngineVersion: request.engineVersion } : {}),
  };
}

const createOutputChannel: OutputChannelFactory = (onMessage) =>
  typeof globalThis.window === "undefined" ? { onmessage: onMessage } : new Channel(onMessage);

export function createTauriBridge(
  invokeCommand: Invoke = invoke,
  channelFactory: OutputChannelFactory = createOutputChannel,
  configuredEnginePath: () => string | null = () => null,
): NativeEngineBridge {
  return {
    render: async (jobId, request, onOutput) => {
      const entry = request.files.get(request.entryFile);
      if (typeof entry !== "string") {
        throw new Error(`The entry document ${request.entryFile} is missing or is not UTF-8 text.`);
      }
      const response = await invokeCommand<NativeRenderWireResponse>(
        "render_native",
        renderArguments(jobId, request, channelFactory(onOutput), configuredEnginePath),
      );
      const diagnostics = nativeDiagnostics(response.rawLog, request);
      if (response.kind === "failure") {
        return {
          kind: "failure",
          reason: response.reason,
          ...(typeof response.exitCode === "number" ? { exitCode: response.exitCode } : {}),
          diagnostics,
          rawLog: response.rawLog,
        };
      }
      if (response.kind === "2d") {
        return {
          kind: "2d",
          svg: response.svg,
          boundingBox: response.bounds,
          diagnostics,
          rawLog: response.rawLog,
        };
      }
      const vertices = reportedStatistic(response.rawLog, "Vertices");
      const bytes = decodeBase64(response.meshBase64);
      if (response.format === "3mf") {
        const parsed = await parseBinaryStlOffThread(bytes, undefined, undefined, "3mf");
        return {
          kind: "3d",
          mesh: {
            format: "3mf",
            bytes,
            ...(parsed.parts ? { parts: parsed.parts } : {}),
          },
          stats: {
            ...(vertices !== undefined ? { vertices } : {}),
            triangles: parsed.triangleCount,
            boundingBox: {
              min: [...parsed.bounds.min] as [number, number, number],
              max: [...parsed.bounds.max] as [number, number, number],
            },
            volumeMm3: closedMeshVolumeMm3(parsed.positions),
            engineTimeMs: response.engineTimeMs,
          },
          diagnostics,
          rawLog: response.rawLog,
        };
      }
      if (!response.bounds || !Number.isSafeInteger(response.triangleCount)) {
        throw new Error("The native engine returned invalid STL render statistics.");
      }
      return {
        kind: "3d",
        mesh: {
          format: response.format,
          bytes,
        },
        stats: {
          ...(vertices !== undefined ? { vertices } : {}),
          triangles: response.triangleCount,
          boundingBox: { min: response.bounds.min, max: response.bounds.max },
          ...(Number.isFinite(response.volumeMm3) ? { volumeMm3: response.volumeMm3 } : {}),
          engineTimeMs: response.engineTimeMs,
        },
        diagnostics,
        rawLog: response.rawLog,
      };
    },
    export: async (jobId, request, onOutput) => {
      const response = await invokeCommand<NativeExportWireResponse>("export_native", {
        ...renderArguments(
          jobId,
          { ...request, quality: "full" },
          channelFactory(onOutput),
          configuredEnginePath,
        ),
        format: request.format,
        image: request.image,
      });
      return {
        ok: response.ok,
        ...(response.artifactBase64 ? { bytes: decodeBase64(response.artifactBase64) } : {}),
        ...(response.fileExtension ? { fileExtension: response.fileExtension } : {}),
        diagnostics: nativeDiagnostics(response.rawLog, request),
        rawLog: response.rawLog,
      };
    },
    version: async (requiredVersion) => {
      const configuredPath = configuredEnginePath()?.trim();
      const response = configuredPath || requiredVersion
        ? await invokeCommand<NativeEngineVersionWireResponse | string | null>("native_engine_version", {
            ...(configuredPath ? { configuredEnginePath: configuredPath } : {}),
            ...(requiredVersion ? { requiredEngineVersion: requiredVersion } : {}),
          })
        : await invokeCommand<NativeEngineVersionWireResponse | string | null>("native_engine_version");
      if (!response) return null;
      if (typeof response === "string") return { version: response, path: "native", features: [] };
      return {
        version: response.version,
        path: "native",
        features: [],
        buildIdentity: response.buildIdentity,
      };
    },
    cancel: (jobId) => {
      void invokeCommand("cancel_native", { jobId }).catch(() => undefined);
    },
  };
}
