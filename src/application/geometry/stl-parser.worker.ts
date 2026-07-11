import { parseBinaryStl } from "./stl";

interface ParseRequest {
  readonly bytes: ArrayBuffer;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { bytes } = event.data;
  try {
    const parsed = parseBinaryStl(new Uint8Array(bytes));
    const positions = parsed.positions.buffer as ArrayBuffer;
    const normals = parsed.normals.buffer as ArrayBuffer;
    scope.postMessage({
      ok: true,
      triangleCount: parsed.triangleCount,
      positions,
      normals,
      bounds: parsed.bounds,
    }, [positions, normals]);
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "The STL could not be parsed.",
    }, []);
  }
};
