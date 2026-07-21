import type { ExportFormat } from "../../../src/application/engine/contracts";
import { createBrowserWasmEngine } from "../../../src/platform-web/browser-wasm-engine";

interface ParityRequest {
  readonly entryFile: string;
  readonly source: string;
  readonly format: "stl-binary" | "svg";
}

interface ParityResult {
  readonly ok: boolean;
  readonly bytes?: number[];
  readonly rawLog: string;
  readonly version: string | null;
}

type ParityWindow = Window & {
  runAc4ParityExport(request: ParityRequest): Promise<ParityResult>;
};

const selection = createBrowserWasmEngine();

(window as ParityWindow).runAc4ParityExport = async (
  request: ParityRequest,
): Promise<ParityResult> => {
  const info = await selection.engine.version();
  const job = selection.engine.export({
    entryFile: request.entryFile,
    files: new Map([[request.entryFile, request.source]]),
    parameters: {},
    format: request.format satisfies ExportFormat,
    timeoutMs: 120_000,
  });
  const result = await job.done;
  return {
    ok: result.ok,
    ...(result.bytes ? { bytes: Array.from(result.bytes) } : {}),
    rawLog: result.rawLog,
    version: info?.version ?? null,
  };
};
