import type { EngineService, ParamValue } from "../engine/contracts";
import { createExportRequest } from "../files/export-flow";
import type { ProjectSnapshot } from "../files/project-snapshot";

export interface SlicerHandoffRequest {
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
  readonly configuredExecutablePath?: string;
}

export interface SlicerHandoffResult {
  readonly slicerName: string;
  readonly temporaryFile: string;
}

export interface SlicerHandoffPort {
  open(request: SlicerHandoffRequest): Promise<SlicerHandoffResult>;
}

export interface StartSlicerHandoffInput {
  readonly engine: EngineService;
  readonly handoff: SlicerHandoffPort;
  readonly snapshot: ProjectSnapshot;
  readonly entryFile: string;
  readonly parameters: Readonly<Record<string, ParamValue>>;
  readonly timeoutMs: number;
  readonly configuredExecutablePath?: string;
}

export interface SlicerHandoffOperation {
  readonly jobId: string;
  readonly done: Promise<SlicerHandoffResult>;
  cancel(): void;
}

function outputName(entryFile: string): string {
  const leaf = entryFile.split("/").at(-1) ?? "model";
  const dot = leaf.lastIndexOf(".");
  return `${dot > 0 ? leaf.slice(0, dot) : leaf || "model"}.3mf`;
}

export function startSlicerHandoff(input: StartSlicerHandoffInput): SlicerHandoffOperation {
  const request = createExportRequest({
    snapshot: input.snapshot,
    entryFile: input.entryFile,
    format: "3mf",
    parameters: input.parameters,
    timeoutMs: input.timeoutMs,
  });
  const job = input.engine.export(request);
  const done = job.done.then((result) => {
    if (!result.ok || !result.bytes || result.bytes.byteLength === 0) {
      throw new Error("3MF export failed; no slicer was launched.");
    }
    return input.handoff.open({
      bytes: result.bytes,
      suggestedName: outputName(input.entryFile),
      ...(input.configuredExecutablePath?.trim()
        ? { configuredExecutablePath: input.configuredExecutablePath.trim() }
        : {}),
    });
  });
  let cancelled = false;
  return {
    jobId: job.jobId,
    done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      input.engine.cancel(job.jobId);
    },
  };
}
