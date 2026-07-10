import type { WorkspaceLayoutPersistence } from "../application/runtime/layout-persistence";

export const BROWSER_LAYOUT_STORAGE_KEY = "scadmill:workspace-layout:v1";

export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type BrowserStorageProvider = () => BrowserStorage | undefined;

function exposeBrowserStorage(): BrowserStorage | undefined {
  return globalThis.localStorage;
}

export function createBrowserLayoutPersistence(
  storage?: BrowserStorage,
  storageProvider: BrowserStorageProvider = exposeBrowserStorage,
): WorkspaceLayoutPersistence {
  let resolvedStorage = storage;
  let storageResolved = storage !== undefined;
  const getStorage = (): BrowserStorage | undefined => {
    if (storageResolved) return resolvedStorage;
    storageResolved = true;
    try {
      resolvedStorage = storageProvider();
    } catch {
      resolvedStorage = undefined;
    }
    return resolvedStorage;
  };

  return {
    load() {
      try {
        return getStorage()?.getItem(BROWSER_LAYOUT_STORAGE_KEY) ?? null;
      } catch {
        return null;
      }
    },
    save(serializedLayout) {
      try {
        getStorage()?.setItem(BROWSER_LAYOUT_STORAGE_KEY, serializedLayout);
      } catch {
        // Storage can be disabled or full; the in-memory layout remains usable.
      }
    },
  };
}
