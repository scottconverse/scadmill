import type { MeshFormat } from "../engine/contracts";
import { analyzeModelPrintability } from "./printability";

self.onmessage = (event: MessageEvent) => {
  try {
    const request = event.data as { bytes: ArrayBuffer; configuration: Parameters<typeof analyzeModelPrintability>[2]; format: MeshFormat };
    const report = analyzeModelPrintability(new Uint8Array(request.bytes), request.format, request.configuration);
    self.postMessage({ ok: true, report });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Printability check failed." });
  }
};
