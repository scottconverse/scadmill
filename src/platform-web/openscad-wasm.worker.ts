import { createAvailableOpenScadWasmArtifactCache } from "./openscad-wasm-cache";
import { loadVerifiedOpenScadWasm } from "./openscad-wasm-loader";
import {
  type OpenScadWasmRuntimeLoader,
  OpenScadWasmWorkerAdapter,
  type OpenScadWasmWorkerScope,
} from "./openscad-wasm-worker-adapter";

export interface OpenScadWasmWorkerProductionDependencies {
  readonly createCache: typeof createAvailableOpenScadWasmArtifactCache;
  readonly loadVerified: typeof loadVerifiedOpenScadWasm;
}

const productionDependencies: OpenScadWasmWorkerProductionDependencies = {
  createCache: createAvailableOpenScadWasmArtifactCache,
  loadVerified: loadVerifiedOpenScadWasm,
};

export function createProductionOpenScadWasmLoader(
  scope: OpenScadWasmWorkerScope,
  dependencies: OpenScadWasmWorkerProductionDependencies = productionDependencies,
  deploymentBaseUrl = import.meta.env.BASE_URL,
): OpenScadWasmRuntimeLoader {
  const applicationBaseUrl = new URL(deploymentBaseUrl, scope.location.href);
  const artifactBaseUrl = new URL("openscad-engine/", applicationBaseUrl);
  let cacheCreated = false;
  let cache: ReturnType<typeof createAvailableOpenScadWasmArtifactCache>;
  return (onProgress) => {
    if (!cacheCreated) {
      cache = dependencies.createCache();
      cacheCreated = true;
    }
    return dependencies.loadVerified({ artifactBaseUrl, cache, onProgress });
  };
}

export function bootOpenScadWasmWorker(
  scope: OpenScadWasmWorkerScope,
  loadRuntime: OpenScadWasmRuntimeLoader = createProductionOpenScadWasmLoader(scope),
): OpenScadWasmWorkerAdapter {
  const adapter = new OpenScadWasmWorkerAdapter(scope, loadRuntime);
  scope.onmessage = ({ data }) => { void adapter.handleMessage(data); };
  return adapter;
}

if (
  typeof WorkerGlobalScope !== "undefined"
  && globalThis instanceof WorkerGlobalScope
) {
  bootOpenScadWasmWorker(globalThis as unknown as OpenScadWasmWorkerScope);
}
