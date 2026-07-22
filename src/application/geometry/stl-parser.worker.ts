import type { ParsedModelMesh } from "./model-mesh";
import { parseBinaryStl } from "./stl";
import { parseThreeMf } from "./three-mf";

interface ParseRequest {
  readonly bytes: ArrayBuffer;
  readonly format?: "stl-binary" | "3mf";
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { bytes, format = "stl-binary" } = event.data;
  try {
    const parsed: ParsedModelMesh = format === "3mf"
      ? parseThreeMf(new Uint8Array(bytes))
      : parseBinaryStl(new Uint8Array(bytes));
    const positions = parsed.positions.buffer as ArrayBuffer;
    const normals = parsed.normals.buffer as ArrayBuffer;
    const colors = parsed.colors?.buffer as ArrayBuffer | undefined;
    scope.postMessage({
      ok: true,
      triangleCount: parsed.triangleCount,
      positions,
      normals,
      ...(colors ? { colors } : {}),
      ...(parsed.parts ? { parts: parsed.parts } : {}),
      bounds: parsed.bounds,
    }, colors ? [positions, normals, colors] : [positions, normals]);
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "The STL could not be parsed.",
    }, []);
  }
};
