import type { RecoveryPersistence } from "../application/files/recovery-state";
import type { RecentProjectsPersistence } from "../application/files/recent-projects";
import type { ScratchAutosavePersistence } from "../application/files/scratch-autosave";
import type { WorkspaceMetadataPersistence } from "../application/viewer/annotation-persistence";
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
