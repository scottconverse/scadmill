import type { CameraBookmarkPersistence } from "../application/viewer/camera-bookmarks";
import type { BrowserStorage } from "./browser-layout-persistence";

const CAMERA_BOOKMARK_STORAGE_PREFIX = "scadmill:camera-bookmarks:v1";

function storageKey(workspaceIdentity: string): string {
  if (workspaceIdentity.trim().length === 0 || workspaceIdentity.length > 256) {
    throw new Error("Camera bookmark workspace identity must be non-empty and bounded.");
  }
  return `${CAMERA_BOOKMARK_STORAGE_PREFIX}:${encodeURIComponent(workspaceIdentity)}`;
}

function availableStorage(storage?: BrowserStorage): BrowserStorage | undefined {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createBrowserCameraBookmarkPersistence(
  storage?: BrowserStorage,
): CameraBookmarkPersistence {
  const selected = availableStorage(storage);
  return {
    load: (workspaceIdentity) => selected?.getItem(storageKey(workspaceIdentity)) ?? null,
    save: (workspaceIdentity, serializedBookmarks) => {
      if (!selected) throw new Error("Browser profile storage is unavailable.");
      selected.setItem(storageKey(workspaceIdentity), serializedBookmarks);
    },
  };
}
