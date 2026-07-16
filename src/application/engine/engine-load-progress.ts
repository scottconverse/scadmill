import type { ReadonlyStore } from "../runtime/workbench-runtime";

export interface EngineLoadAssetProgress {
  readonly asset: string;
  readonly loadedBytes: number;
  readonly totalBytes: number | null;
}

export interface EngineLoadProgressState {
  readonly assets: readonly EngineLoadAssetProgress[];
}

export type EngineLoadProgressStore = ReadonlyStore<EngineLoadProgressState>;
