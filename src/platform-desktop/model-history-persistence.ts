import type { ParamValue, Quality } from "../application/engine/contracts";
import { parseProjectPath } from "../application/files/project-path";
import {
  MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE,
  MAX_MODEL_HISTORY_WORKSPACE_BYTES,
  type ModelHistoryPersistence,
  type ModelHistorySnapshot,
  validateModelHistorySnapshot,
} from "../application/model-history/model-history";

interface DurableWebviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PersistedSnapshot extends Omit<ModelHistorySnapshot, "thumbnailPng"> {
  readonly thumbnailBase64?: string;
}

const STORAGE_PREFIX = "scadmill.desktop-model-history.v1";
const OPAQUE_PROJECT_IDENTITY = /^desktop-project:[0-9a-f]{64}$/u;

function availableStorage(storage?: DurableWebviewStorage): DurableWebviewStorage | undefined {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return undefined; }
}

function storageKey(
  workspaceIdentity: string,
  suffix: "enabled" | "snapshots",
  prefix: string,
  allowAnyWorkspace: boolean,
): string | null {
  const identity = workspaceIdentity.trim();
  if (!identity || identity === "scratch") return null;
  if (!allowAnyWorkspace && !OPAQUE_PROJECT_IDENTITY.test(identity)) return null;
  return `${prefix}:${suffix}:${identity}`;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isParamValue(value: unknown): value is ParamValue {
  return typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "string"
    || (Array.isArray(value) && value.every((item) => typeof item === "number"));
}

function decodeSnapshot(value: unknown): ModelHistorySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid model history snapshot.");
  }
  const record = value as Record<string, unknown>;
  const parameters = record.parameters;
  if (
    typeof record.snapshotId !== "string"
    || typeof record.workspaceIdentity !== "string"
    || typeof record.documentId !== "string"
    || typeof record.documentPath !== "string"
    || typeof record.renderIdentity !== "string"
    || typeof record.capturedAt !== "string"
    || (record.quality !== "preview" && record.quality !== "full")
    || typeof record.source !== "string"
    || !parameters
    || typeof parameters !== "object"
    || Array.isArray(parameters)
    || !Object.values(parameters).every(isParamValue)
    || (record.thumbnailBase64 !== undefined && typeof record.thumbnailBase64 !== "string")
  ) throw new Error("Invalid model history snapshot values.");
  return validateModelHistorySnapshot({
    snapshotId: record.snapshotId,
    workspaceIdentity: record.workspaceIdentity,
    documentId: record.documentId,
    documentPath: parseProjectPath(record.documentPath),
    renderIdentity: record.renderIdentity,
    capturedAt: record.capturedAt,
    quality: record.quality as Quality,
    source: record.source,
    parameters: parameters as Readonly<Record<string, ParamValue>>,
    ...(record.thumbnailBase64 === undefined
      ? {}
      : { thumbnailPng: decodeBase64(record.thumbnailBase64) }),
  });
}

function encodeSnapshot(snapshot: ModelHistorySnapshot): PersistedSnapshot {
  const validated = validateModelHistorySnapshot(snapshot);
  const { thumbnailPng, ...rest } = validated;
  return {
    ...rest,
    ...(thumbnailPng ? { thumbnailBase64: encodeBase64(thumbnailPng) } : {}),
  };
}

function decodeSnapshots(serialized: string | null, workspaceIdentity: string): readonly ModelHistorySnapshot[] {
  if (serialized === null) return [];
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid model history envelope.");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.version !== 1 || !Array.isArray(envelope.snapshots)
    || envelope.snapshots.length > MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE) {
    throw new Error("Unsupported model history envelope.");
  }
  if (serialized.length * 2 > MAX_MODEL_HISTORY_WORKSPACE_BYTES) {
    throw new Error("Model history workspace exceeds the supported size.");
  }
  const snapshots = envelope.snapshots.map(decodeSnapshot);
  if (snapshots.some((snapshot) => snapshot.workspaceIdentity !== workspaceIdentity)) {
    throw new Error("Model history snapshot belongs to another workspace.");
  }
  if (new Set(snapshots.map(({ snapshotId }) => snapshotId)).size !== snapshots.length) {
    throw new Error("Model history snapshot identities must be unique.");
  }
  return snapshots;
}

export function createDesktopModelHistoryPersistence(
  storage?: DurableWebviewStorage,
  options: { readonly prefix?: string; readonly allowAnyWorkspace?: boolean } = {},
): ModelHistoryPersistence {
  const selected = availableStorage(storage);
  const prefix = options.prefix ?? STORAGE_PREFIX;
  const allowAnyWorkspace = options.allowAnyWorkspace ?? false;
  const key = (workspaceIdentity: string, suffix: "enabled" | "snapshots") => (
    storageKey(workspaceIdentity, suffix, prefix, allowAnyWorkspace)
  );
  const supportsWorkspace = (workspaceIdentity: string) => Boolean(
    selected && key(workspaceIdentity, "snapshots"),
  );
  return {
    supportsWorkspace,
    isEnabled: (workspaceIdentity) => {
      const enabledKey = key(workspaceIdentity, "enabled");
      return Boolean(selected && enabledKey && selected.getItem(enabledKey) === "true");
    },
    setEnabled: (workspaceIdentity, enabled) => {
      const enabledKey = key(workspaceIdentity, "enabled");
      const snapshotsKey = key(workspaceIdentity, "snapshots");
      if (!selected || !enabledKey || !snapshotsKey) {
        throw new Error("Model history persistence requires a supported project workspace.");
      }
      if (enabled) selected.setItem(enabledKey, "true");
      else {
        selected.removeItem(enabledKey);
        selected.removeItem(snapshotsKey);
      }
    },
    load: (workspaceIdentity) => {
      const snapshotsKey = key(workspaceIdentity, "snapshots");
      if (!selected || !snapshotsKey || !supportsWorkspace(workspaceIdentity)) return [];
      if (selected.getItem(key(workspaceIdentity, "enabled") ?? "") !== "true") return [];
      try { return decodeSnapshots(selected.getItem(snapshotsKey), workspaceIdentity); }
      catch { return []; }
    },
    save: (workspaceIdentity, snapshots) => {
      const snapshotsKey = key(workspaceIdentity, "snapshots");
      if (!selected || !snapshotsKey || !supportsWorkspace(workspaceIdentity)) {
        throw new Error("Model history persistence requires a supported project workspace.");
      }
      if (selected.getItem(key(workspaceIdentity, "enabled") ?? "") !== "true") {
        throw new Error("Model history persistence is not enabled for this project.");
      }
      const encoded: PersistedSnapshot[] = [];
      for (let index = snapshots.length - 1; index >= 0; index -= 1) {
        const candidate = encodeSnapshot(snapshots[index] as ModelHistorySnapshot);
        const next = [candidate, ...encoded];
        const serialized = JSON.stringify({ version: 1, snapshots: next });
        if (next.length > MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE
          || serialized.length * 2 > MAX_MODEL_HISTORY_WORKSPACE_BYTES) break;
        encoded.unshift(candidate);
      }
      selected.setItem(snapshotsKey, JSON.stringify({ version: 1, snapshots: encoded }));
    },
    clear: (workspaceIdentity) => {
      const snapshotsKey = key(workspaceIdentity, "snapshots");
      if (!selected || !snapshotsKey) {
        throw new Error("Model history persistence requires a supported project workspace.");
      }
      selected.removeItem(snapshotsKey);
    },
  };
}

export function createBrowserModelHistoryPersistence(
  storage?: DurableWebviewStorage,
): ModelHistoryPersistence {
  return createDesktopModelHistoryPersistence(storage, {
    prefix: "scadmill.browser-model-history.v1",
    allowAnyWorkspace: true,
  });
}
