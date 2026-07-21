import type { ParamValue, Quality } from "../engine/contracts";
import { type ProjectPath, parseProjectPath } from "../files/project-path";
import { MAX_RENDER_THUMBNAIL_BYTES } from "../render-cache/render-thumbnail-persistence";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export const MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE = 100;
export const MAX_MODEL_HISTORY_WORKSPACE_BYTES = 16 * 1024 * 1024;

export interface ModelHistorySnapshotInput {
  readonly snapshotId: string;
  readonly workspaceIdentity: string;
  readonly documentId: string;
  readonly documentPath: ProjectPath;
  readonly renderIdentity: string;
  readonly capturedAt: string;
  readonly quality: Quality;
  readonly source: string;
  readonly parameters: Readonly<Record<string, ParamValue>>;
}

export interface ModelHistorySnapshot extends ModelHistorySnapshotInput {
  readonly thumbnailPng?: Uint8Array;
}

export interface ModelHistoryPersistence {
  supportsWorkspace(workspaceIdentity: string): boolean;
  isEnabled(workspaceIdentity: string): boolean;
  setEnabled(workspaceIdentity: string, enabled: boolean): void;
  load(workspaceIdentity: string): readonly ModelHistorySnapshot[];
  save(workspaceIdentity: string, snapshots: readonly ModelHistorySnapshot[]): void;
  clear(workspaceIdentity: string): void;
}

export interface ModelHistoryPersistenceState {
  readonly supported: boolean;
  readonly enabled: boolean;
  readonly status: "ready" | "error";
}

export const EPHEMERAL_MODEL_HISTORY_PERSISTENCE: ModelHistoryPersistence = Object.freeze({
  supportsWorkspace: () => false,
  isEnabled: () => false,
  setEnabled: () => undefined,
  load: () => [],
  save: () => undefined,
  clear: () => undefined,
});

function requireIdentity(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must be non-empty.`);
  return normalized;
}

function cloneParameters(
  parameters: Readonly<Record<string, ParamValue>>,
): Readonly<Record<string, ParamValue>> {
  return Object.fromEntries(Object.entries(parameters).map(([name, value]) => [
    name,
    Array.isArray(value) ? [...value] : value,
  ]));
}

function cloneSnapshot(snapshot: ModelHistorySnapshot): ModelHistorySnapshot {
  return {
    ...snapshot,
    parameters: cloneParameters(snapshot.parameters),
    ...(snapshot.thumbnailPng ? { thumbnailPng: snapshot.thumbnailPng.slice() } : {}),
  };
}

function validateThumbnail(bytes: Uint8Array): Uint8Array {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < PNG_SIGNATURE.length
    || bytes.byteLength > MAX_RENDER_THUMBNAIL_BYTES
    || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) throw new Error("Model history thumbnail must be a bounded PNG byte array.");
  return bytes.slice();
}

export class ModelHistoryTimeline {
  readonly #snapshots: ModelHistorySnapshot[] = [];

  capture(input: ModelHistorySnapshotInput): void {
    const snapshotId = requireIdentity(input.snapshotId, "Snapshot identity");
    const workspaceIdentity = requireIdentity(input.workspaceIdentity, "Workspace identity");
    const documentId = requireIdentity(input.documentId, "Document identity");
    const renderIdentity = requireIdentity(input.renderIdentity, "Render identity");
    if (Number.isNaN(Date.parse(input.capturedAt))) {
      throw new Error("Model history capture time must be a timestamp.");
    }
    if (this.#snapshots.some((snapshot) => (
      snapshot.workspaceIdentity === workspaceIdentity && snapshot.snapshotId === snapshotId
    ))) throw new Error(`Duplicate model history snapshot ${snapshotId}.`);
    this.#snapshots.push({
      ...input,
      snapshotId,
      workspaceIdentity,
      documentId,
      documentPath: parseProjectPath(input.documentPath),
      renderIdentity,
      parameters: cloneParameters(input.parameters),
    });
    while (this.#snapshots.filter((snapshot) => (
      snapshot.workspaceIdentity === workspaceIdentity
    )).length > MAX_MODEL_HISTORY_SNAPSHOTS_PER_WORKSPACE) {
      const oldest = this.#snapshots.findIndex((snapshot) => (
        snapshot.workspaceIdentity === workspaceIdentity
      ));
      if (oldest === -1) break;
      this.#snapshots.splice(oldest, 1);
    }
  }

  listDocument(workspaceIdentity: string, documentId: string): readonly ModelHistorySnapshot[] {
    const workspace = requireIdentity(workspaceIdentity, "Workspace identity");
    const document = requireIdentity(documentId, "Document identity");
    return this.#snapshots
      .filter((snapshot) => (
        snapshot.workspaceIdentity === workspace && snapshot.documentId === document
      ))
      .map(cloneSnapshot);
  }

  listAll(): readonly ModelHistorySnapshot[] {
    return this.#snapshots.map(cloneSnapshot);
  }

  listWorkspace(workspaceIdentity: string): readonly ModelHistorySnapshot[] {
    const workspace = requireIdentity(workspaceIdentity, "Workspace identity");
    return this.#snapshots
      .filter((snapshot) => snapshot.workspaceIdentity === workspace)
      .map(cloneSnapshot);
  }

  get(workspaceIdentity: string, snapshotId: string): ModelHistorySnapshot | undefined {
    const workspace = requireIdentity(workspaceIdentity, "Workspace identity");
    const identity = requireIdentity(snapshotId, "Snapshot identity");
    const snapshot = this.#snapshots.find((candidate) => (
      candidate.workspaceIdentity === workspace && candidate.snapshotId === identity
    ));
    return snapshot ? cloneSnapshot(snapshot) : undefined;
  }

  attachThumbnail(workspaceIdentity: string, snapshotId: string, pngBytes: Uint8Array): boolean {
    const workspace = requireIdentity(workspaceIdentity, "Workspace identity");
    const identity = requireIdentity(snapshotId, "Snapshot identity");
    const index = this.#snapshots.findIndex((snapshot) => (
      snapshot.workspaceIdentity === workspace && snapshot.snapshotId === identity
    ));
    if (index === -1) return false;
    const snapshot = this.#snapshots[index];
    if (!snapshot) return false;
    this.#snapshots[index] = { ...snapshot, thumbnailPng: validateThumbnail(pngBytes) };
    return true;
  }
}

export function validateModelHistorySnapshot(snapshot: ModelHistorySnapshot): ModelHistorySnapshot {
  const timeline = new ModelHistoryTimeline();
  timeline.capture(snapshot);
  if (snapshot.thumbnailPng) {
    timeline.attachThumbnail(snapshot.workspaceIdentity, snapshot.snapshotId, snapshot.thumbnailPng);
  }
  const validated = timeline.listAll()[0];
  if (!validated) throw new Error("Model history snapshot could not be validated.");
  return validated;
}
