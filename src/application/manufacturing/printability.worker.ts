import { analyzePrintability } from "./printability";

self.onmessage = (event: MessageEvent) => {
  try {
    const request = event.data as { bytes: ArrayBuffer; configuration: Parameters<typeof analyzePrintability>[1] };
    const report = analyzePrintability(new Uint8Array(request.bytes), request.configuration);
    self.postMessage({ ok: true, report });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Printability check failed." });
  }
};
