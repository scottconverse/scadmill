import type { RecoveryPersistence } from "../application/files/recovery-state";
import type { RecentProjectsPersistence } from "../application/files/recent-projects";
import type { ScratchAutosavePersistence } from "../application/files/scratch-autosave";
import type { WorkspaceLayoutPersistence } from "../application/runtime/layout-persistence";
import type { WorkspaceMetadataPersistence } from "../application/viewer/annotation-persistence";
import type { RenderDiskCachePreferencePersistence } from "../application/render-cache/render-cache-preference";
import {
  createBrowserRecentProjectsPersistence,
  createBrowserRecoveryPersistence,
  createBrowserScratchAutosavePersistence,
  createBrowserWorkspaceMetadataPersistence,
} from "../platform-web/browser-project-metadata";

interface DurableWebviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const DESKTOP_LAYOUT_STORAGE_PREFIX = "scadmill.desktop-workspace-layout.v1";
const DESKTOP_RENDER_CACHE_PREFERENCE_PREFIX = "scadmill.desktop-render-cache-preference.v1";
const OPAQUE_PROJECT_IDENTITY = /^desktop-project:[0-9a-f]{64}$/u;

function availableStorage(storage?: DurableWebviewStorage): DurableWebviewStorage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function desktopLayoutStorageKey(workspaceIdentity: string): string | null {
  if (workspaceIdentity === "scratch" || OPAQUE_PROJECT_IDENTITY.test(workspaceIdentity)) {
    return `${DESKTOP_LAYOUT_STORAGE_PREFIX}:${workspaceIdentity}`;
  }
  return null;
}

function desktopRenderCachePreferenceKey(workspaceIdentity: string): string | null {
  return OPAQUE_PROJECT_IDENTITY.test(workspaceIdentity)
    ? `${DESKTOP_RENDER_CACHE_PREFERENCE_PREFIX}:${workspaceIdentity}`
    : null;
}

export function createDesktopRenderDiskCachePreferencePersistence(
  storage?: DurableWebviewStorage,
): RenderDiskCachePreferencePersistence {
  const selected = availableStorage(storage);
  return {
    load: (workspaceIdentity) => {
      const key = desktopRenderCachePreferenceKey(workspaceIdentity);
      if (!key) return false;
      return selected?.getItem(key) === "enabled";
    },
    save: (workspaceIdentity, enabled) => {
      const key = desktopRenderCachePreferenceKey(workspaceIdentity);
      if (!key) throw new Error("Render-cache preference requires an opaque desktop project identity.");
      if (!selected) throw new Error("Desktop profile storage is unavailable.");
      if (enabled) selected.setItem(key, "enabled");
      else selected.removeItem(key);
    },
  };
}

export function createDesktopWorkspaceLayoutPersistence(
  storage?: DurableWebviewStorage,
): WorkspaceLayoutPersistence {
  const selected = availableStorage(storage);
  return {
    load: (workspaceIdentity) => {
      const key = desktopLayoutStorageKey(workspaceIdentity);
      if (!key) return null;
      try {
        return selected?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save: (workspaceIdentity, serializedLayout) => {
      const key = desktopLayoutStorageKey(workspaceIdentity);
      if (!key) return;
      try {
        selected?.setItem(key, serializedLayout);
      } catch {
        // A blocked or full WebView profile must not make the workspace unusable.
      }
    },
  };
}

export function createDesktopScratchAutosavePersistence(
  storage?: DurableWebviewStorage,
): ScratchAutosavePersistence {
  return createBrowserScratchAutosavePersistence(storage);
}

export function createDesktopRecoveryPersistence(
  storage?: DurableWebviewStorage,
): RecoveryPersistence {
  return createBrowserRecoveryPersistence(storage);
}

export function createDesktopRecentProjectsPersistence(
  storage?: DurableWebviewStorage,
): RecentProjectsPersistence {
  return createBrowserRecentProjectsPersistence(storage);
}

export function createDesktopWorkspaceMetadataPersistence(
  storage?: DurableWebviewStorage,
): WorkspaceMetadataPersistence {
  return createBrowserWorkspaceMetadataPersistence(storage);
}
