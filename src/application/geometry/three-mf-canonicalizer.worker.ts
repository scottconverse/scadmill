import { canonicalThreeMfGeometryBytes } from "./three-mf";

interface CanonicalizeRequest {
  readonly bytes: ArrayBuffer;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<CanonicalizeRequest>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (event) => {
  try {
    const canonical = canonicalThreeMfGeometryBytes(new Uint8Array(event.data.bytes));
    const bytes = canonical.buffer as ArrayBuffer;
    scope.postMessage({ ok: true, bytes }, [bytes]);
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "The 3MF geometry could not be canonicalized.",
    }, []);
  }
};
