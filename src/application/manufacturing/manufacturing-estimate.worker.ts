import type { MeshFormat } from "../engine/contracts";
import { manufacturingEstimateStl } from "./manufacturing-estimate-mesh";

interface EstimateMeshRequest {
  readonly bytes: ArrayBuffer;
  readonly format: MeshFormat;
}

function request(value: unknown): EstimateMeshRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The manufacturing estimate request is invalid.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== 2
    || !(candidate.bytes instanceof ArrayBuffer)
    || (candidate.format !== "stl-binary" && candidate.format !== "3mf")
  ) throw new Error("The manufacturing estimate request is invalid.");
  return candidate as unknown as EstimateMeshRequest;
}

self.onmessage = (event: MessageEvent<unknown>) => {
  try {
    const input = request(event.data);
    const bytes = manufacturingEstimateStl(new Uint8Array(input.bytes), input.format);
    const stl = bytes.buffer as ArrayBuffer;
    self.postMessage({ ok: true, stl }, [stl]);
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "The estimate mesh could not be prepared.",
    });
  }
};
