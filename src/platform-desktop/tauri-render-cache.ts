import { invoke } from "@tauri-apps/api/core";

import type {
  RenderDiskCacheRecord,
  RenderDiskCacheStorage,
} from "../application/render-cache/render-disk-cache";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function bytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
    return new Uint8Array(value);
  }
  return undefined;
}

export function createTauriRenderCacheStorage(invokeCommand: Invoke = invoke): RenderDiskCacheStorage {
  const identity = (workspaceIdentity: string, key: string) => ({ workspaceIdentity, key });
  return {
    async read(projectIdentity, key) {
      const response = await invokeCommand<unknown>("render_cache_read", identity(projectIdentity, key));
      return bytes(response);
    },
    async write(projectIdentity, key, value, maxBytes) {
      await invokeCommand("render_cache_write", {
        ...identity(projectIdentity, key),
        bytes: value,
        ...(maxBytes === undefined ? {} : { maxBytes }),
      });
    },
    async remove(projectIdentity, key) {
      await invokeCommand("render_cache_remove", identity(projectIdentity, key));
    },
    async clear(projectIdentity) {
      await invokeCommand("render_cache_clear", { workspaceIdentity: projectIdentity });
    },
    async touch(projectIdentity, key, _atMs) {
      await invokeCommand("render_cache_touch", identity(projectIdentity, key));
    },
    async list(projectIdentity) {
      const response = await invokeCommand<unknown>("render_cache_list", { workspaceIdentity: projectIdentity });
      if (!Array.isArray(response)) return [];
      return response.flatMap((item): RenderDiskCacheRecord[] => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        return typeof record.key === "string"
          && typeof record.byteSize === "number"
          && Number.isFinite(record.byteSize)
          && typeof record.lastAccessMs === "number"
          && Number.isFinite(record.lastAccessMs)
          ? [{ key: record.key, byteSize: record.byteSize, lastAccessMs: record.lastAccessMs }]
          : [];
      });
    },
  };
}
