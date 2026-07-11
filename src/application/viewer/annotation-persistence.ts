import { parseProjectPath } from "../files/project-path";
import type { ViewerAnnotation } from "./viewer-state";

const METADATA_BYTE_LIMIT = 1024 * 1024;
const FILE_LIMIT = 2_048;
const ANNOTATION_LIMIT = 256;
const PROJECT_ID_BYTE_LIMIT = 2_048;
const PATH_BYTE_LIMIT = 4_096;
const ANNOTATION_ID_BYTE_LIMIT = 256;

export interface WorkspaceMetadataPersistence {
  load(): string | null;
  save(serialized: string): void;
}

export interface WorkspaceAnnotationFile {
  readonly projectId: string;
  readonly path: string;
  readonly annotations: readonly ViewerAnnotation[];
}

export interface WorkspaceAnnotationMetadata {
  readonly version: 1;
  readonly files: readonly WorkspaceAnnotationFile[];
}

export interface WorkspaceAnnotationPersistenceState {
  readonly status: "saved" | "unsaved" | "load-error" | "load-error-unsaved";
}

export const EPHEMERAL_WORKSPACE_METADATA_PERSISTENCE: WorkspaceMetadataPersistence = {
  load: () => null,
  save: () => undefined,
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")
  ) throw new Error(`${label} does not use the exact version-1 shape.`);
  return value as Record<string, unknown>;
}

function boundedIdentity(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.length > maximumBytes
    || byteLength(value) > maximumBytes
  ) throw new Error(`${label} is empty or exceeds the supported size.`);
  return value;
}

function cloneAnnotation(value: unknown): ViewerAnnotation {
  const record = exactRecord(value, ["id", "point", "text"], "Workspace annotation");
  const id = boundedIdentity(record.id, "Annotation id", ANNOTATION_ID_BYTE_LIMIT);
  const text = boundedIdentity(record.text, "Annotation text", METADATA_BYTE_LIMIT);
  if (text.length > 240) throw new Error("Annotation text must contain 1 to 240 characters.");
  if (
    !Array.isArray(record.point)
    || record.point.length !== 3
    || !record.point.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
  ) throw new Error("Annotation point must contain three finite coordinates.");
  return { id, point: [record.point[0], record.point[1], record.point[2]], text };
}

function normalizeMetadata(value: unknown): WorkspaceAnnotationMetadata {
  const root = exactRecord(value, ["files", "version"], "Workspace metadata");
  if (root.version !== 1 || !Array.isArray(root.files) || root.files.length > FILE_LIMIT) {
    throw new Error("Workspace metadata version or file count is unsupported.");
  }
  const identities = new Set<string>();
  const files = root.files.map((value) => {
    const record = exactRecord(
      value,
      ["annotations", "path", "projectId"],
      "Workspace annotation file",
    );
    const projectId = boundedIdentity(record.projectId, "Project id", PROJECT_ID_BYTE_LIMIT);
    const rawPath = boundedIdentity(record.path, "Project path", PATH_BYTE_LIMIT);
    const path = parseProjectPath(rawPath);
    if (!Array.isArray(record.annotations) || record.annotations.length > ANNOTATION_LIMIT) {
      throw new Error("A project file contains too many annotations.");
    }
    const annotationIds = new Set<string>();
    const annotations = record.annotations.map((annotation) => {
      const cloned = cloneAnnotation(annotation);
      if (annotationIds.has(cloned.id)) throw new Error("Annotation ids must be unique per file.");
      annotationIds.add(cloned.id);
      return cloned;
    });
    const identity = JSON.stringify([projectId, path.toLowerCase()]);
    if (identities.has(identity)) throw new Error("Workspace annotation files must be unique.");
    identities.add(identity);
    return { projectId, path, annotations };
  });
  return { version: 1, files };
}

export function parseWorkspaceAnnotationMetadata(serialized: string): WorkspaceAnnotationMetadata {
  if (
    serialized.length > METADATA_BYTE_LIMIT
    || byteLength(serialized) > METADATA_BYTE_LIMIT
  ) {
    throw new Error("Workspace metadata exceeds the supported size.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Workspace metadata is not valid JSON.");
  }
  return normalizeMetadata(parsed);
}

export function serializeWorkspaceAnnotationMetadata(
  metadata: WorkspaceAnnotationMetadata,
): string {
  const normalized = normalizeMetadata(metadata);
  const serialized = JSON.stringify({
    version: 1,
    files: [...normalized.files]
      .sort((left, right) => left.projectId.localeCompare(right.projectId) || left.path.localeCompare(right.path))
      .map(({ projectId, path, annotations }) => ({ projectId, path, annotations })),
  });
  if (byteLength(serialized) > METADATA_BYTE_LIMIT) {
    throw new Error("Workspace metadata exceeds the supported size.");
  }
  return serialized;
}

function cloneFile(file: WorkspaceAnnotationFile): WorkspaceAnnotationFile {
  return {
    projectId: file.projectId,
    path: file.path,
    annotations: file.annotations.map(cloneAnnotation),
  };
}

export class WorkspaceAnnotationRepository {
  private files: WorkspaceAnnotationFile[];
  private persistenceState: WorkspaceAnnotationPersistenceState = { status: "saved" };
  private dirty = false;

  constructor(private readonly persistence: WorkspaceMetadataPersistence) {
    let serialized: string | null = null;
    try {
      serialized = persistence.load();
    } catch {
      this.files = [];
      this.persistenceState = { status: "load-error" };
      return;
    }
    try {
      this.files = serialized === null
        ? []
        : parseWorkspaceAnnotationMetadata(serialized).files.map(cloneFile);
    } catch {
      this.files = [];
      this.persistenceState = { status: "load-error" };
    }
  }

  state(): WorkspaceAnnotationPersistenceState {
    return { ...this.persistenceState };
  }

  serializeCurrent(): string {
    return serializeWorkspaceAnnotationMetadata({ version: 1, files: this.files });
  }

  retry(): void {
    if (this.persistenceState.status !== "load-error" || this.dirty) {
      this.persist();
      return;
    }
    try {
      const serialized = this.persistence.load();
      this.files = serialized === null
        ? []
        : parseWorkspaceAnnotationMetadata(serialized).files.map(cloneFile);
      this.persistenceState = { status: "saved" };
    } catch (error) {
      this.persistenceState = { status: "load-error" };
      throw error;
    }
  }

  annotations(projectId: string, path: string): readonly ViewerAnnotation[] {
    const file = this.files.find((candidate) =>
      candidate.projectId === projectId && candidate.path === path);
    return file?.annotations.map(cloneAnnotation) ?? [];
  }

  replace(projectId: string, path: string, annotations: readonly ViewerAnnotation[]): void {
    const next = normalizeMetadata({
      version: 1,
      files: [
        ...this.files.filter((candidate) =>
          candidate.projectId !== projectId || candidate.path !== path),
        ...(annotations.length === 0 ? [] : [{ projectId, path, annotations }]),
      ],
    });
    this.files = next.files.map(cloneFile);
    this.dirty = true;
    this.persist();
  }

  move(projectId: string, from: string, to: string): void {
    const annotations = this.annotations(projectId, from);
    if (annotations.length === 0 || from === to) return;
    this.files = this.files.filter((candidate) =>
      candidate.projectId !== projectId || candidate.path !== from);
    this.replace(projectId, to, annotations);
  }

  copy(projectId: string, from: string, to: string): void {
    const annotations = this.annotations(projectId, from);
    if (annotations.length === 0) return;
    this.replace(projectId, to, annotations);
  }

  delete(projectId: string, path: string): void {
    if (!this.files.some((candidate) =>
      candidate.projectId === projectId && candidate.path === path)) return;
    this.files = this.files.filter((candidate) =>
      candidate.projectId !== projectId || candidate.path !== path);
    this.dirty = true;
    this.persist();
  }

  private persist(): void {
    if (this.persistenceState.status === "load-error" && this.dirty) {
      this.persistenceState = { status: "load-error-unsaved" };
      return;
    }
    const preservesLoadFailure = this.persistenceState.status === "load-error-unsaved";
    try {
      this.persistence.save(this.serializeCurrent());
      this.dirty = false;
      this.persistenceState = { status: "saved" };
    } catch (error) {
      this.persistenceState = {
        status: preservesLoadFailure ? "load-error-unsaved" : "unsaved",
      };
      throw error;
    }
  }
}
