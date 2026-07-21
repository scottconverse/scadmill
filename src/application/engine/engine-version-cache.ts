import type { EngineInfo, EngineService } from "./contracts";

const cache = new WeakMap<object, Map<string, Promise<EngineInfo | null>>>();

export function cachedEngineVersion(
  engine: EngineService,
  configuredPath = "",
  requiredVersion?: string,
): Promise<EngineInfo | null> {
  const byPath = cache.get(engine) ?? new Map<string, Promise<EngineInfo | null>>();
  cache.set(engine, byPath);
  const key = `${configuredPath}\u0000${requiredVersion ?? ""}`;
  const existing = byPath.get(key);
  if (existing) return existing;
  const result = Promise.resolve(engine.version(requiredVersion)).catch(() => null);
  byPath.set(key, result);
  return result;
}

export function invalidateCachedEngineVersion(engine: EngineService, configuredPath = ""): void {
  const byPath = cache.get(engine);
  if (!byPath) return;
  for (const key of byPath.keys()) if (key.startsWith(`${configuredPath}\u0000`)) byPath.delete(key);
}
