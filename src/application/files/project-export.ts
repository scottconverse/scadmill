import type {
  Diagnostic,
  EngineService,
  ExportFormat,
  ExportRequest,
  ParamValue,
} from "../engine/contracts";
import type { ArtifactDestination } from "./artifact-destination";
import {
  createExportRequest,
  summarizeExportArtifact,
  type ExportArtifactSummary,
} from "./export-flow";
import type { ProjectSnapshot } from "./project-snapshot";
import { messages } from "../../messages/en";

export interface ProjectExportInput {
  readonly engine: EngineService;
  readonly destination: ArtifactDestination;
  readonly snapshot: ProjectSnapshot;
  readonly entryFile: string;
  readonly format: ExportFormat;
  readonly parameters: Readonly<Record<string, ParamValue>>;
  readonly timeoutMs: number;
  readonly image?: ExportRequest["image"];
}

export interface ProjectExportCompletion extends ExportArtifactSummary {
  readonly format: ExportFormat;
  readonly location: string;
  readonly fileName: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ProjectExportOperation {
  readonly jobId: string;
  readonly done: Promise<ProjectExportCompletion>;
  cancel(): void;
}

export class ProjectExportError extends Error {
  readonly phase: "validation" | "engine" | "destination";
  readonly diagnostics: readonly Diagnostic[];

  constructor(
    phase: "validation" | "engine" | "destination",
    message: string,
    diagnostics: readonly Diagnostic[] = [],
  ) {
    super(message);
    this.name = "ProjectExportError";
    this.phase = phase;
    this.diagnostics = diagnostics;
  }
}

const FORMAT_ARTIFACT: Readonly<Record<ExportFormat, { extension: string; mimeType: string }>> = {
  "3mf": { extension: "3mf", mimeType: "model/3mf" },
  "stl-binary": { extension: "stl", mimeType: "model/stl" },
  "stl-ascii": { extension: "stl", mimeType: "model/stl" },
  "off": { extension: "off", mimeType: "application/octet-stream" },
  "amf": { extension: "amf", mimeType: "application/x-amf" },
  "svg": { extension: "svg", mimeType: "image/svg+xml" },
  "dxf": { extension: "dxf", mimeType: "image/vnd.dxf" },
  "png": { extension: "png", mimeType: "image/png" },
};

function outputFileName(entryFile: string, format: ExportFormat): string {
  const leaf = entryFile.split("/").at(-1) ?? "model";
  const dot = leaf.lastIndexOf(".");
  const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
  return `${stem || "model"}.${FORMAT_ARTIFACT[format].extension}`;
}

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function engineFailureMessage(diagnostics: readonly Diagnostic[], byteLess: boolean): string {
  if (byteLess) return messages.projectExportNoBytes;
  const error = diagnostics.find(({ severity }) => severity === "error");
  return error
    ? messages.projectExportEngineDiagnostic(error.message)
    : messages.projectExportEngineGeneric;
}

function isMeshFormat(format: ExportFormat): boolean {
  return format === "3mf"
    || format === "stl-binary"
    || format === "stl-ascii"
    || format === "off"
    || format === "amf";
}

function needsSummaryCompanion(format: ExportFormat): boolean {
  return isMeshFormat(format) && format !== "stl-binary";
}

export function startProjectExport(input: ProjectExportInput): ProjectExportOperation {
  if (!input.destination.available) {
    throw new ProjectExportError("validation", messages.projectExportDestinationUnavailableError);
  }

  let request: ExportRequest;
  try {
    request = createExportRequest(input);
  } catch (reason) {
    throw new ProjectExportError("validation", reasonMessage(reason));
  }

  let job: ReturnType<EngineService["export"]> | undefined;
  let summaryJob: ReturnType<EngineService["export"]> | undefined;
  try {
    job = input.engine.export(request);
    if (needsSummaryCompanion(input.format)) {
      summaryJob = input.engine.export(createExportRequest({
        ...input,
        format: "stl-binary",
        image: undefined,
      }));
    }
  } catch (reason) {
    if (job) input.engine.cancel(job.jobId);
    throw new ProjectExportError(
      "engine",
      messages.projectExportStartFailed(reasonMessage(reason)),
    );
  }

  const fileName = outputFileName(input.entryFile, input.format);
  const primaryJob = job;
  const jobs = summaryJob ? [primaryJob, summaryJob] : [primaryJob];
  const done = Promise.all(jobs.map(({ done: result }) => result)).then(async (
    [result, summaryResult],
  ): Promise<ProjectExportCompletion> => {
    if (!result.ok || !result.bytes) {
      throw new ProjectExportError(
        "engine",
        engineFailureMessage(result.diagnostics, result.ok),
        result.diagnostics,
      );
    }

    const diagnostics = summaryResult
      ? [...result.diagnostics, ...summaryResult.diagnostics]
      : [...result.diagnostics];
    if (summaryResult && (!summaryResult.ok || !summaryResult.bytes)) {
      const detail = engineFailureMessage(summaryResult.diagnostics, summaryResult.ok);
      throw new ProjectExportError(
        "engine",
        messages.projectExportSummaryFailed(input.format, detail),
        diagnostics,
      );
    }

    let summary: ExportArtifactSummary;
    try {
      if (isMeshFormat(input.format)) {
        const geometry = summarizeExportArtifact(
          "stl-binary",
          summaryResult?.bytes ?? result.bytes,
        );
        summary = {
          fileSizeBytes: result.bytes.byteLength,
          triangleCount: geometry.triangleCount,
          boundingBox: geometry.boundingBox,
        };
      } else {
        summary = summarizeExportArtifact(input.format, result.bytes);
      }
    } catch (reason) {
      throw new ProjectExportError(
        "engine",
        messages.projectExportInvalidStatistics(reasonMessage(reason)),
        diagnostics,
      );
    }

    let saved: Awaited<ReturnType<ArtifactDestination["save"]>>;
    try {
      saved = await input.destination.save({
        suggestedName: fileName,
        bytes: result.bytes,
        mimeType: FORMAT_ARTIFACT[input.format].mimeType,
      });
    } catch (reason) {
      throw new ProjectExportError(
        "destination",
        messages.projectExportSaveFailed(fileName, reasonMessage(reason)),
        diagnostics,
      );
    }
    if (typeof saved.location !== "string" || saved.location.trim().length === 0) {
      throw new ProjectExportError(
        "destination",
        messages.projectExportNoSavedLocation(fileName),
        diagnostics,
      );
    }

    return {
      format: input.format,
      location: saved.location,
      fileName,
      ...summary,
      diagnostics,
    };
  });
  let cancelled = false;
  return {
    jobId: job.jobId,
    done,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      for (const activeJob of jobs) input.engine.cancel(activeJob.jobId);
    },
  };
}
