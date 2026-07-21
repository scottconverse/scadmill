import type { ViewerCameraState } from "./viewer-state";

export interface CameraBookmark {
  readonly id: string;
  readonly name: string;
  readonly camera: ViewerCameraState;
}

export interface CameraBookmarkPersistence {
  load(workspaceIdentity: string): string | null;
  save(workspaceIdentity: string, serializedBookmarks: string): void;
}

export const EPHEMERAL_CAMERA_BOOKMARK_PERSISTENCE: CameraBookmarkPersistence = Object.freeze({
  load: (_workspaceIdentity: string) => null,
  save: (_workspaceIdentity: string, _serializedBookmarks: string) => undefined,
});

const BOOKMARK_LIMIT = 64;
const SERIALIZED_LIMIT = 64 * 1024;

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) throw new Error(`${label} has an unsupported shape.`);
  return value as Record<string, unknown>;
}

function identity(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new Error(`${label} must be non-empty and bounded.`);
  }
  return value;
}

function point(value: unknown): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) =>
    typeof item === "number" && Number.isFinite(item))) {
    throw new Error("Camera points must contain three finite coordinates.");
  }
  return [value[0], value[1], value[2]];
}

function camera(value: unknown): ViewerCameraState {
  const record = exactRecord(value, ["position", "projection", "target", "up", "zoom"], "Camera");
  if (record.projection !== "perspective" && record.projection !== "orthographic") {
    throw new Error("Camera projection is invalid.");
  }
  if (typeof record.zoom !== "number" || !Number.isFinite(record.zoom) || record.zoom <= 0) {
    throw new Error("Camera zoom must be finite and positive.");
  }
  return {
    projection: record.projection,
    position: point(record.position),
    target: point(record.target),
    up: point(record.up),
    zoom: record.zoom,
  };
}

function bookmark(value: unknown): CameraBookmark {
  const record = exactRecord(value, ["camera", "id", "name"], "Camera bookmark");
  return {
    id: identity(record.id, "Camera bookmark id", 128),
    name: identity(record.name, "Camera bookmark name", 80),
    camera: camera(record.camera),
  };
}

function normalize(values: unknown): readonly CameraBookmark[] {
  if (!Array.isArray(values) || values.length > BOOKMARK_LIMIT) {
    throw new Error("Camera bookmark list contains too many entries.");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  return values.map((value) => {
    const item = bookmark(value);
    const nameKey = item.name.trim().toLocaleLowerCase();
    if (ids.has(item.id) || names.has(nameKey)) {
      throw new Error("Camera bookmark ids and names must be unique.");
    }
    ids.add(item.id);
    names.add(nameKey);
    return item;
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export function parseCameraBookmarks(serialized: string): readonly CameraBookmark[] {
  if (new TextEncoder().encode(serialized).byteLength > SERIALIZED_LIMIT) {
    throw new Error("Camera bookmark data exceeds the supported size.");
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("Camera bookmark data is not valid JSON.");
  }
  const root = exactRecord(value, ["bookmarks", "version"], "Camera bookmark data");
  if (root.version !== 1) throw new Error("Camera bookmark version is unsupported.");
  return normalize(root.bookmarks);
}

export function serializeCameraBookmarks(bookmarks: readonly CameraBookmark[]): string {
  const serialized = JSON.stringify({ version: 1, bookmarks: normalize(bookmarks) });
  if (new TextEncoder().encode(serialized).byteLength > SERIALIZED_LIMIT) {
    throw new Error("Camera bookmark data exceeds the supported size.");
  }
  return serialized;
}
