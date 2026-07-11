import {
  isDocumentDirty,
  type DocumentWorkspaceState,
} from "../documents/document-workspace";

export interface RecoveryBuffer {
  readonly documentId: string;
  readonly path: string;
  readonly source: string;
  readonly savedSource: string;
}

export interface RecoverySnapshot {
  readonly version: 1;
  readonly projectId: string;
  readonly capturedAt: string;
  readonly buffers: readonly RecoveryBuffer[];
}

export interface RecoveryPersistence {
  load(): string | null;
  save(serialized: string): void;
  clear(): void;
}

function dirtyBuffers(workspace: DocumentWorkspaceState): RecoveryBuffer[] {
  return workspace.documents
    .filter(isDocumentDirty)
    .map(({ id, path, source, savedSource }) => ({
      documentId: id,
      path,
      source,
      savedSource,
    }));
}

function suffixedRecoveryPath(path: string, ordinal: number): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const extension = path.lastIndexOf(".");
  const insertion = extension > separator ? extension : path.length;
  return `${path.slice(0, insertion)} (recovery ${ordinal})${path.slice(insertion)}`;
}

function reserveDistinctBuffer(
  buffer: RecoveryBuffer,
  documentIds: Set<string>,
  paths: Set<string>,
): RecoveryBuffer {
  let documentId = buffer.documentId;
  for (let ordinal = 2; documentIds.has(documentId); ordinal += 1) {
    documentId = `${buffer.documentId}-recovery-${ordinal}`;
  }
  documentIds.add(documentId);

  let path = buffer.path;
  for (let ordinal = 2; paths.has(path.toLowerCase()); ordinal += 1) {
    path = suffixedRecoveryPath(buffer.path, ordinal);
  }
  paths.add(path.toLowerCase());
  return { ...buffer, documentId, path };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBuffer(value: unknown): RecoveryBuffer | null {
  if (!object(value)) return null;
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "documentId,path,savedSource,source") return null;
  if (
    !nonEmptyString(value.documentId)
    || !nonEmptyString(value.path)
    || typeof value.source !== "string"
    || typeof value.savedSource !== "string"
  ) return null;
  return {
    documentId: value.documentId,
    path: value.path,
    source: value.source,
    savedSource: value.savedSource,
  };
}

export function parseRecoverySnapshot(serialized: string): RecoverySnapshot {
  const value: unknown = JSON.parse(serialized);
  if (!object(value) || Object.keys(value).sort().join(",") !== "buffers,capturedAt,projectId,version") {
    throw new Error("Recovery data has an invalid shape.");
  }
  if (
    value.version !== 1
    || !nonEmptyString(value.projectId)
    || !nonEmptyString(value.capturedAt)
    || !Array.isArray(value.buffers)
  ) throw new Error("Recovery data is invalid.");
  const buffers = value.buffers.map(parseBuffer);
  if (buffers.some((buffer) => buffer === null)) throw new Error("Recovery buffer is invalid.");
  const valid = buffers as RecoveryBuffer[];
  if (
    new Set(valid.map(({ documentId }) => documentId)).size !== valid.length
    || new Set(valid.map(({ path }) => path.toLowerCase())).size !== valid.length
  ) throw new Error("Recovery buffers must be unique.");
  return {
    version: 1,
    projectId: value.projectId,
    capturedAt: value.capturedAt,
    buffers: valid,
  };
}

export class RecoveryCoordinator {
  constructor(
    private readonly persistence: RecoveryPersistence,
    private readonly now = () => new Date().toISOString(),
  ) {}

  capture(projectId: string, workspace: DocumentWorkspaceState): void {
    const buffers = dirtyBuffers(workspace);
    if (buffers.length === 0) {
      this.persistence.clear();
      return;
    }
    if (!projectId.trim()) throw new Error("Recovery project id must be non-empty.");
    this.persistence.save(JSON.stringify({
      version: 1,
      projectId,
      capturedAt: this.now(),
      buffers,
    } satisfies RecoverySnapshot));
  }

  captureAlongside(pending: RecoverySnapshot, workspace: DocumentWorkspaceState): void {
    const current = dirtyBuffers(workspace);
    if (current.length === 0) return;
    const documentIds = new Set(pending.buffers.map(({ documentId }) => documentId));
    const paths = new Set(pending.buffers.map(({ path }) => path.toLowerCase()));
    const buffers = [
      ...pending.buffers,
      ...current.map((buffer) => reserveDistinctBuffer(buffer, documentIds, paths)),
    ];
    this.persistence.save(JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: this.now(),
      buffers,
    } satisfies RecoverySnapshot));
  }

  load(): RecoverySnapshot | null {
    const serialized = this.persistence.load();
    if (serialized === null) return null;
    try {
      return parseRecoverySnapshot(serialized);
    } catch {
      return null;
    }
  }

  discard(): void {
    this.persistence.clear();
  }
}
