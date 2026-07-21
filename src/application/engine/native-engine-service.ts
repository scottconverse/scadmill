import type {
  EngineInfo,
  EngineOutputEvent,
  EngineService,
  ExportRequest,
  ExportResult,
  RenderJob,
  RenderRequest,
  RenderResult,
} from "./contracts";

export interface NativeEngineBridge {
  render(
    jobId: string,
    request: RenderRequest,
    onOutput: (event: EngineOutputEvent) => void,
  ): Promise<RenderResult>;
  export(
    jobId: string,
    request: ExportRequest,
    onOutput: (event: EngineOutputEvent) => void,
  ): Promise<ExportResult>;
  version(requiredVersion?: string): Promise<EngineInfo | null>;
  cancel(jobId: string): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The native engine operation failed.";
}

function outputSubscription() {
  const events: EngineOutputEvent[] = [];
  const listeners = new Set<(event: EngineOutputEvent) => void>();
  return {
    emit(event: EngineOutputEvent) {
      events.push(event);
      for (const listener of listeners) listener(event);
    },
    subscribe(listener: (event: EngineOutputEvent) => void) {
      for (const event of events) listener(event);
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export class NativeEngineService implements EngineService {
  constructor(
    private readonly bridge: NativeEngineBridge,
    private readonly makeJobId: () => string,
  ) {}

  render(request: RenderRequest): RenderJob<RenderResult> {
    const jobId = this.makeJobId();
    const output = outputSubscription();
    return {
      jobId,
      subscribeOutput: output.subscribe,
      done: this.bridge.render(jobId, request, output.emit).catch((error: unknown) => {
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
    const output = outputSubscription();
    return {
      jobId,
      subscribeOutput: output.subscribe,
      done: this.bridge.export(jobId, request, output.emit).catch((error: unknown) => {
        const message = errorMessage(error);
        return {
          ok: false,
          diagnostics: [{ severity: "error", message }],
          rawLog: message,
        };
      }),
    };
  }

  version(requiredVersion?: string): Promise<EngineInfo | null> {
    return this.bridge.version(requiredVersion);
  }

  cancel(jobId: string): void {
    this.bridge.cancel(jobId);
  }
}
