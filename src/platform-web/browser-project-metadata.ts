import type { RecoveryPersistence } from "../application/files/recovery-state";
import type { ScratchAutosavePersistence } from "../application/files/scratch-autosave";
import {
  type RecentProject,
  type RecentProjectsPersistence,
  validateRecentProjects,
} from "../application/files/recent-projects";
import { messages } from "../messages/en";

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RECOVERY_KEY = "scadmill.recovery.v1";
const RECENT_PROJECTS_KEY = "scadmill.recent-projects.v1";
const SCRATCH_AUTOSAVE_KEY = "scadmill.scratch-autosave.v1";

function availableStorage(storage?: KeyValueStorage): KeyValueStorage | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createBrowserRecoveryPersistence(
  storage?: KeyValueStorage,
): RecoveryPersistence {
  const selected = availableStorage(storage);
  return {
    load: () => {
      try { return selected?.getItem(RECOVERY_KEY) ?? null; } catch { return null; }
    },
    save: (serialized) => {
      try {
        if (!selected) throw new Error("unavailable");
        selected.setItem(RECOVERY_KEY, serialized);
      } catch {
        throw new Error(messages.recoveryCouldNotBeSaved);
      }
    },
    clear: () => {
      try {
        if (!selected) throw new Error("unavailable");
        selected.removeItem(RECOVERY_KEY);
      } catch {
        throw new Error(messages.recoveryCouldNotBeCleared);
      }
    },
  };
}

function decodeRecentProjects(serialized: string | null): readonly RecentProject[] {
  if (serialized === null) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      typeof parsed !== "object"
      || parsed === null
      || Array.isArray(parsed)
      || Object.keys(parsed).sort().join(",") !== "projects,version"
    ) return [];
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.projects)) return [];
    const projects = record.projects.map((value) => {
      if (
        typeof value !== "object"
        || value === null
        || Array.isArray(value)
        || Object.keys(value).sort().join(",") !== "displayName,openedAt,projectId"
      ) throw new Error("Invalid recent project entry.");
      return value as unknown as RecentProject;
    });
    return validateRecentProjects(projects);
  } catch {
    return [];
  }
}

export function createBrowserRecentProjectsPersistence(
  storage?: KeyValueStorage,
): RecentProjectsPersistence {
  const selected = availableStorage(storage);
  return {
    load: () => {
      try { return decodeRecentProjects(selected?.getItem(RECENT_PROJECTS_KEY) ?? null); } catch { return []; }
    },
    save: (projects) => {
      try {
        if (!selected) throw new Error("unavailable");
        selected.setItem(RECENT_PROJECTS_KEY, JSON.stringify({
          version: 1,
          projects: validateRecentProjects(projects),
        }));
      } catch {
        throw new Error(messages.recentProjectsCouldNotBeSaved);
      }
    },
  };
}

export function createBrowserScratchAutosavePersistence(
  storage?: KeyValueStorage,
): ScratchAutosavePersistence {
  const selected = availableStorage(storage);
  return {
    load: () => {
      try { return selected?.getItem(SCRATCH_AUTOSAVE_KEY) ?? null; } catch { return null; }
    },
    save: (source) => {
      try {
        if (!selected) throw new Error("unavailable");
        selected.setItem(SCRATCH_AUTOSAVE_KEY, source);
      } catch {
        throw new Error(messages.scratchAutosaveFailed);
      }
    },
  };
}
