import type { EngineInfo, EngineService } from "./contracts";

const cache = new WeakMap<object, Map<string, Promise<EngineInfo | null>>>();

export function cachedEngineVersion(engine: EngineService, configuredPath = ""): Promise<EngineInfo | null> {
  const byPath = cache.get(engine) ?? new Map<string, Promise<EngineInfo | null>>();
  cache.set(engine, byPath);
  const existing = byPath.get(configuredPath);
  if (existing) return existing;
  const result = Promise.resolve(engine.version()).catch(() => null);
  byPath.set(configuredPath, result);
  return result;
}
