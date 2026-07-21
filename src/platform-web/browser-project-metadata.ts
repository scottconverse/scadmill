import { parseProjectPath } from "../application/files/project-path";
import {
  type RecentProject,
  type RecentProjectsPersistence,
  validateRecentProjects,
} from "../application/files/recent-projects";
import type { RecoveryPersistence } from "../application/files/recovery-state";
import type { ScratchAutosavePersistence } from "../application/files/scratch-autosave";
import type { WorkspaceMetadataPersistence } from "../application/viewer/annotation-persistence";
import { messages } from "../messages/en";

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RECOVERY_KEY = "scadmill.recovery.v1";
const LEGACY_RECENT_PROJECTS_KEY = "scadmill.recent-projects.v1";
const RECENT_PROJECTS_KEY = "scadmill.recent-projects.v2";
const LEGACY_SCRATCH_AUTOSAVE_KEY = "scadmill.scratch-autosave.v1";
const SCRATCH_AUTOSAVE_KEY = "scadmill.scratch-autosave.v2";
const WORKSPACE_METADATA_KEY = "scadmill.workspace-metadata.v1";

function availableStorage(storage?: KeyValueStorage): KeyValueStorage | null {
  if (storage) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createBrowserWorkspaceMetadataPersistence(
  storage?: KeyValueStorage,
): WorkspaceMetadataPersistence {
  const selected = availableStorage(storage);
  return {
    load: () => {
      try {
        if (!selected) throw new Error("unavailable");
        return selected.getItem(WORKSPACE_METADATA_KEY);
      } catch {
        throw new Error(messages.workspaceMetadataCouldNotBeLoaded);
      }
    },
    save: (serialized) => {
      try {
        if (!selected) throw new Error("unavailable");
        selected.setItem(WORKSPACE_METADATA_KEY, serialized);
      } catch {
        throw new Error(messages.workspaceMetadataCouldNotBeSaved);
      }
    },
  };
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

function decodeRecentProjects(serialized: string | null, version: 1 | 2): readonly RecentProject[] {
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
    if (record.version !== version || !Array.isArray(record.projects)) return [];
    const projects = record.projects.map((value) => {
      const expectedKeys = version === 1
        ? "displayName,openedAt,projectId"
        : "displayName,openedAt,projectId,workspaceIdentity";
      if (
        typeof value !== "object"
        || value === null
        || Array.isArray(value)
        || Object.keys(value).sort().join(",") !== expectedKeys
      ) throw new Error("Invalid recent project entry.");
      const entry = value as Record<string, unknown>;
      return version === 1
        ? { ...entry, workspaceIdentity: entry.projectId } as unknown as RecentProject
        : value as unknown as RecentProject;
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
      try {
        const current = selected?.getItem(RECENT_PROJECTS_KEY) ?? null;
        return current === null
          ? decodeRecentProjects(selected?.getItem(LEGACY_RECENT_PROJECTS_KEY) ?? null, 1)
          : decodeRecentProjects(current, 2);
      } catch { return []; }
    },
    save: (projects) => {
      try {
        if (!selected) throw new Error("unavailable");
        selected.setItem(RECENT_PROJECTS_KEY, JSON.stringify({
          version: 2,
          projects: validateRecentProjects(projects),
        }));
        selected.removeItem(LEGACY_RECENT_PROJECTS_KEY);
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
      try {
        const serialized = selected?.getItem(SCRATCH_AUTOSAVE_KEY) ?? null;
        if (serialized !== null) {
          const parsed: unknown = JSON.parse(serialized);
          if (
            typeof parsed !== "object"
            || parsed === null
            || Array.isArray(parsed)
            || Object.keys(parsed).sort().join(",") !== "path,source,version"
          ) return null;
          const record = parsed as Record<string, unknown>;
          if (record.version !== 2 || typeof record.path !== "string" || typeof record.source !== "string") {
            return null;
          }
          return { path: parseProjectPath(record.path), source: record.source };
        }
        const legacySource = selected?.getItem(LEGACY_SCRATCH_AUTOSAVE_KEY) ?? null;
        return legacySource === null ? null : { path: "Untitled.scad", source: legacySource };
      } catch {
        return null;
      }
    },
    save: (snapshot) => {
      try {
        if (!selected) throw new Error("unavailable");
        const path = parseProjectPath(snapshot.path);
        if (typeof snapshot.source !== "string") throw new Error("invalid source");
        selected.setItem(SCRATCH_AUTOSAVE_KEY, JSON.stringify({
          version: 2,
          path,
          source: snapshot.source,
        }));
        selected.removeItem(LEGACY_SCRATCH_AUTOSAVE_KEY);
      } catch {
        throw new Error(messages.scratchAutosaveFailed);
      }
    },
  };
}
