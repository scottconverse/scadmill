import type { EngineService } from "../application/engine/contracts";
import type {
  EngineLoadProgressState,
  EngineLoadProgressStore,
} from "../application/engine/engine-load-progress";
import type {
  WasmEngineLoadProgress,
  WasmEngineWorkerLike,
} from "./wasm-engine-protocol";
import { WasmEngineService } from "./wasm-engine-service";

const EMPTY_PROGRESS = Object.freeze({
  assets: Object.freeze([]),
}) satisfies EngineLoadProgressState;

const ASSET_ORDER: Readonly<Record<string, number>> = {
  "openscad.js": 0,
  "openscad.wasm": 1,
};

export class BrowserWasmEngineProgressStore
  implements EngineLoadProgressStore
{
  private state: EngineLoadProgressState = EMPTY_PROGRESS;
  private readonly listeners = new Set<(
    state: EngineLoadProgressState,
    previousState: EngineLoadProgressState,
  ) => void>();

  getState(): EngineLoadProgressState {
    return this.state;
  }

  getInitialState(): EngineLoadProgressState {
    return EMPTY_PROGRESS;
  }

  subscribe(listener: (
    state: EngineLoadProgressState,
    previousState: EngineLoadProgressState,
  ) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  record(progress: WasmEngineLoadProgress): void {
    if (!this.isValid(progress)) return;
    const existing = this.state.assets.find(({ asset }) => asset === progress.asset);
    if (existing && progress.loadedBytes < existing.loadedBytes) return;
    if (
      existing
      && existing.totalBytes !== null
      && progress.totalBytes !== null
      && existing.totalBytes !== progress.totalBytes
    ) return;
    const totalBytes = existing?.totalBytes ?? progress.totalBytes;
    if (totalBytes !== null && progress.loadedBytes > totalBytes) return;
    const nextProgress = Object.freeze({ ...progress, totalBytes });
    if (
      existing?.loadedBytes === nextProgress.loadedBytes
      && existing.totalBytes === nextProgress.totalBytes
    ) return;
    const assets = this.state.assets
      .filter(({ asset }) => asset !== progress.asset)
      .concat(nextProgress)
      .sort((left, right) => ASSET_ORDER[left.asset] - ASSET_ORDER[right.asset]);
    this.publish(Object.freeze({ assets: Object.freeze(assets) }));
  }

  clear(): void {
    if (this.state === EMPTY_PROGRESS) return;
    this.publish(EMPTY_PROGRESS);
  }

  private isValid(progress: WasmEngineLoadProgress): boolean {
    return Number.isSafeInteger(progress.loadedBytes)
      && progress.loadedBytes >= 0
      && (progress.totalBytes === null
        || (Number.isSafeInteger(progress.totalBytes)
          && progress.totalBytes >= progress.loadedBytes));
  }

  private publish(state: EngineLoadProgressState): void {
    const previous = this.state;
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener(state, previous);
      } catch {
        // UI observers cannot interrupt the engine worker lifecycle.
      }
    }
  }
}

export interface BrowserWasmEngineSelection {
  readonly engine: EngineService;
  readonly progress: BrowserWasmEngineProgressStore;
  clearProgress(): void;
}

export function createBrowserWasmEngineProgressStore(): BrowserWasmEngineProgressStore {
  return new BrowserWasmEngineProgressStore();
}

function createOpenScadWasmWorker(): WasmEngineWorkerLike {
  return new Worker(
    new URL("./openscad-wasm.worker.ts", import.meta.url),
    { type: "module" },
  ) as unknown as WasmEngineWorkerLike;
}

export function createBrowserWasmEngine(): BrowserWasmEngineSelection {
  const progress = createBrowserWasmEngineProgressStore();
  return {
    engine: new WasmEngineService({
      workerFactory: createOpenScadWasmWorker,
      onProgress: (event) => progress.record(event),
    }),
    progress,
    clearProgress: () => progress.clear(),
  };
}
