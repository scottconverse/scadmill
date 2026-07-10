import type {
  EngineInfo,
  EngineService,
  ExportRequest,
  ExportResult,
  RenderJob,
  RenderRequest,
  RenderResult,
} from "./contracts";

export interface NativeEngineBridge {
  render(jobId: string, request: RenderRequest): Promise<RenderResult>;
  export(jobId: string, request: ExportRequest): Promise<ExportResult>;
  version(): Promise<EngineInfo | null>;
  cancel(jobId: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The native engine operation failed.";
}

export class NativeEngineService implements EngineService {
  constructor(
    private readonly bridge: NativeEngineBridge,
    private readonly makeJobId: () => string,
  ) {}

  render(request: RenderRequest): RenderJob<RenderResult> {
    const jobId = this.makeJobId();
    return {
      jobId,
      done: this.bridge.render(jobId, request).catch((error: unknown) => {
        const message = errorMessage(error);
        return {
          kind: "failure",
          reason: "engine-error",
          diagnostics: [{ severity: "error", message }],
          rawLog: message,
        } satisfies RenderResult;
      }),
    };
  }

  export(request: ExportRequest): RenderJob<ExportResult> {
    const jobId = this.makeJobId();
    return {
      jobId,
      done: this.bridge.export(jobId, request).catch((error: unknown) => {
        const message = errorMessage(error);
        return {
          ok: false,
          diagnostics: [{ severity: "error", message }],
          rawLog: message,
        };
      }),
    };
  }

  version(): Promise<EngineInfo | null> {
    return this.bridge.version();
  }

  cancel(jobId: string): void {
    this.bridge.cancel(jobId);
  }
}
