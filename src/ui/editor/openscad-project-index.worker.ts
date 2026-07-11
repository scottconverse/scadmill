import {
  indexOpenScadProject,
  OpenScadProjectIndexCache,
  ProjectIndexWorkerRequestRegistry,
  parseProjectFileEventsInWorker,
  type ProjectReference,
} from "./openscad-project-index";

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
}

interface SourceWaiter {
  readonly resolve: (source: string | undefined) => void;
}

const scope = globalThis as unknown as WorkerScope;
const cache = new OpenScadProjectIndexCache();
const requests = new ProjectIndexWorkerRequestRegistry();
const sourceWaiters = new Map<string, SourceWaiter>();

function waiterKey(requestId: number, path: string): string {
  return `${requestId}:${path}`;
}

function readSource(requestId: number, path: string): Promise<string | undefined> {
  if (requests.isCancelled(requestId)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    sourceWaiters.set(waiterKey(requestId, path), { resolve });
    scope.postMessage({ type: "read-project-source", requestId, path });
  });
}

function cancelRequest(requestId: number): void {
  requests.cancel(requestId);
  const prefix = `${requestId}:`;
  for (const [key, waiter] of sourceWaiters) {
    if (!key.startsWith(prefix)) continue;
    sourceWaiters.delete(key);
    waiter.resolve(undefined);
  }
}

function validReferences(value: unknown): value is readonly ProjectReference[] {
  return Array.isArray(value) && value.every((reference) => (
    typeof reference === "object"
    && reference !== null
    && (reference as { kind?: unknown }).kind !== undefined
    && ((reference as { kind: unknown }).kind === "include"
      || (reference as { kind: unknown }).kind === "use")
    && typeof (reference as { path?: unknown }).path === "string"
  ));
}

scope.onmessage = (event) => {
  const value = event.data;
  if (typeof value !== "object" || value === null) return;
  const message = value as Record<string, unknown>;
  if (!Number.isSafeInteger(message.requestId)) return;
  const requestId = message.requestId as number;

  if (message.type === "cancel-project-index") {
    cancelRequest(requestId);
    return;
  }
  if (
    message.type === "project-source"
    && typeof message.path === "string"
    && (typeof message.source === "string" || message.source === undefined)
  ) {
    const key = waiterKey(requestId, message.path);
    const waiter = sourceWaiters.get(key);
    if (waiter) {
      sourceWaiters.delete(key);
      waiter.resolve(message.source as string | undefined);
    }
    return;
  }
  if (
    message.type !== "index-project"
    || typeof message.documentPath !== "string"
    || !validReferences(message.references)
  ) return;

  requests.start(requestId);
  void indexOpenScadProject({
    documentPath: message.documentPath,
    references: message.references,
    readSource: (path) => readSource(requestId, path),
    parseFile: parseProjectFileEventsInWorker,
    cache,
    isCancelled: () => requests.isCancelled(requestId),
  }).then(
    (symbols) => {
      if (!requests.isCancelled(requestId)) {
        scope.postMessage({ type: "project-index-result", requestId, symbols });
      }
      requests.finish(requestId);
    },
    () => {
      if (!requests.isCancelled(requestId)) {
        scope.postMessage({ type: "project-index-error", requestId });
      }
      requests.finish(requestId);
    },
  );
};
