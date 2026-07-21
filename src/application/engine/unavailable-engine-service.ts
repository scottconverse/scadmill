import type {
  EngineInfo,
  EngineService,
  ExportResult,
  RenderJob,
  RenderResult,
} from "./contracts";
import { messages } from "../../messages/en";

export class UnavailableEngineService implements EngineService {
  private nextId = 0;

  render(): RenderJob<RenderResult> {
    return {
      jobId: `unavailable-${++this.nextId}`,
      subscribeOutput: () => () => undefined,
      done: Promise.resolve({
        kind: "failure",
        reason: "engine-missing",
        diagnostics: [{ severity: "error", message: messages.engineUnavailable }],
        rawLog: messages.engineUnavailable,
      }),
    };
  }

  export(): RenderJob<ExportResult> {
    return {
      jobId: `unavailable-${++this.nextId}`,
      subscribeOutput: () => () => undefined,
      done: Promise.resolve({
        ok: false,
        diagnostics: [{ severity: "error", message: messages.engineUnavailable }],
        rawLog: messages.engineUnavailable,
      }),
    };
  }

  version(): Promise<EngineInfo | null> {
    return Promise.resolve(null);
  }

  cancel(): void {}
}
