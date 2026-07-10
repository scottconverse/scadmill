import type { EnginePathConfiguration } from "../application/engine/engine-path-configuration";

const ENGINE_PATH_KEY = "scadmill.nativeEnginePath";

export interface EnginePathStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createEnginePathConfiguration(
  storage: EnginePathStorage = globalThis.localStorage,
): EnginePathConfiguration {
  return {
    load: () => storage.getItem(ENGINE_PATH_KEY)?.trim() ?? "",
    save(path) {
      const normalized = path.trim();
      if (normalized) storage.setItem(ENGINE_PATH_KEY, normalized);
      else storage.removeItem(ENGINE_PATH_KEY);
    },
  };
}
