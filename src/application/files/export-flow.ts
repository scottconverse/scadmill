import type {
  ExportFormat,
  ExportRequest,
  ParamValue,
} from "../engine/contracts";
import { parseBinaryStl } from "../geometry/stl";
import { parseProjectPath } from "./project-path";
import type { ProjectSnapshot } from "./project-snapshot";

export interface ExportRequestInput {
  readonly snapshot: ProjectSnapshot;
  readonly entryFile: string;
  readonly format: ExportFormat;
  readonly parameters: Readonly<Record<string, ParamValue>>;
  readonly timeoutMs: number;
  readonly image?: ExportRequest["image"];
}

export interface ExportArtifactSummary {
  readonly fileSizeBytes: number;
  readonly triangleCount?: number;
  readonly boundingBox?: ReturnType<typeof parseBinaryStl>["bounds"];
}

export function defaultExportFormat(resultKind: "2d" | "3d"): ExportFormat {
  return resultKind === "3d" ? "3mf" : "svg";
}

export function createExportRequest(input: ExportRequestInput): ExportRequest {
  const entryFile = parseProjectPath(input.entryFile);
  if (typeof input.snapshot.files.get(entryFile) !== "string") {
    throw new Error("The export entry file is missing or is not UTF-8 text.");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("Export timeout must be a positive integer.");
  }
  return {
    entryFile,
    files: input.snapshot.files,
    parameters: input.parameters,
    format: input.format,
    timeoutMs: input.timeoutMs,
    ...(input.image ? { image: input.image } : {}),
  };
}

export function summarizeExportArtifact(
  format: ExportFormat,
  bytes: Uint8Array,
): ExportArtifactSummary {
  if (format !== "stl-binary") return { fileSizeBytes: bytes.byteLength };
  const parsed = parseBinaryStl(bytes);
  return {
    fileSizeBytes: bytes.byteLength,
    triangleCount: parsed.triangleCount,
    boundingBox: parsed.bounds,
  };
}
