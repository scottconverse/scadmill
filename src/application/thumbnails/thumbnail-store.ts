import { type ProjectPath, parseProjectPath } from "../files/project-path";
import { isSha256GeometryIdentity } from "../geometry/geometry-identity";

export const THUMBNAIL_RECORD_VERSION = 1 as const;
export const THUMBNAIL_WIDTH = 240 as const;
export const THUMBNAIL_HEIGHT = 160 as const;
export const MAX_THUMBNAIL_BYTES = 256 * 1_024;
export const DEFAULT_THUMBNAIL_STORE_BYTES = 16 * 1_024 * 1_024;

const MAX_ENCODED_RECORD_BYTES = 370_000;
const MAX_IDENTITY_LENGTH = 512;
const MAX_PATH_LENGTH = 1_024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export interface ThumbnailRecord {
  readonly version: typeof THUMBNAIL_RECORD_VERSION;
  readonly workspaceIdentity: string;
  readonly documentPath: ProjectPath;
  readonly renderIdentity: string;
  readonly geometryIdentity?: string;
  readonly capturedAtMs: number;
  readonly width: typeof THUMBNAIL_WIDTH;
  readonly height: typeof THUMBNAIL_HEIGHT;
  readonly mimeType: "image/png";
  readonly bytes: Uint8Array;
}

interface ThumbnailEnvelope {
  readonly version: typeof THUMBNAIL_RECORD_VERSION;
  readonly workspaceIdentity: string;
  readonly documentPath: string;
  readonly renderIdentity: string;
  readonly geometryIdentity?: string;
  readonly capturedAtMs: number;
  readonly width: typeof THUMBNAIL_WIDTH;
  readonly height: typeof THUMBNAIL_HEIGHT;
  readonly mimeType: "image/png";
  readonly bytesBase64: string;
}

interface StoredThumbnail {
  readonly byteSize: number;
  readonly record: ThumbnailRecord;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowed.has(key))
  ) throw new Error("Thumbnail record fields are invalid.");
}

function requireIdentity(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_IDENTITY_LENGTH
    || value !== value.trim()
  ) throw new Error(`${label} must be a non-empty canonical identity.`);
}

function requirePath(value: unknown): ProjectPath {
  if (typeof value !== "string" || value.length > MAX_PATH_LENGTH) {
    throw new Error("Thumbnail document path is invalid.");
  }
  return parseProjectPath(value);
}

function requirePng(bytes: unknown): asserts bytes is Uint8Array {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength < 24
    || bytes.byteLength > MAX_THUMBNAIL_BYTES
  ) {
    throw new Error("Thumbnail bytes must be a bounded PNG byte array.");
  }
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("Thumbnail bytes do not have a PNG signature.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hasIhdr = view.getUint32(8) === 13
    && bytes[12] === 73
    && bytes[13] === 72
    && bytes[14] === 68
    && bytes[15] === 82;
  if (!hasIhdr || view.getUint32(16) !== THUMBNAIL_WIDTH || view.getUint32(20) !== THUMBNAIL_HEIGHT) {
    throw new Error("Thumbnail PNG dimensions must be 240 by 160 pixels.");
  }
}

function validateRecord(value: unknown): asserts value is ThumbnailRecord {
  if (!isObject(value)) throw new Error("Thumbnail record must be an object.");
  requireExactKeys(
    value,
    [
      "version", "workspaceIdentity", "documentPath", "renderIdentity", "capturedAtMs",
      "width", "height", "mimeType", "bytes",
    ],
    ["geometryIdentity"],
  );
  if (value.version !== THUMBNAIL_RECORD_VERSION) throw new Error("Unsupported thumbnail version.");
  requireIdentity(value.workspaceIdentity, "Workspace identity");
  requirePath(value.documentPath);
  requireIdentity(value.renderIdentity, "Render identity");
  if (value.geometryIdentity !== undefined && !isSha256GeometryIdentity(value.geometryIdentity)) {
    throw new Error("Thumbnail geometry identity is invalid.");
  }
  if (!Number.isSafeInteger(value.capturedAtMs) || (value.capturedAtMs as number) < 0) {
    throw new Error("Thumbnail capture time is invalid.");
  }
  if (value.width !== THUMBNAIL_WIDTH || value.height !== THUMBNAIL_HEIGHT) {
    throw new Error("Thumbnail dimensions are invalid.");
  }
  if (value.mimeType !== "image/png") throw new Error("Thumbnail MIME type is invalid.");
  requirePng(value.bytes);
}

function cloneRecord(record: ThumbnailRecord): ThumbnailRecord {
  return { ...record, bytes: record.bytes.slice() };
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 1) {
    binary += String.fromCharCode(bytes[offset] ?? 0);
  }
  return btoa(binary);
}

function base64Decode(value: unknown): Uint8Array {
  if (
    typeof value !== "string"
    || value.length > Math.ceil(MAX_THUMBNAIL_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new Error("Thumbnail base64 is invalid.");
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Thumbnail base64 is invalid.");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64Encode(bytes) !== value) throw new Error("Thumbnail base64 is not canonical.");
  return bytes;
}

export function encodeThumbnailRecord(record: ThumbnailRecord): Uint8Array {
  validateRecord(record);
  const envelope: ThumbnailEnvelope = {
    version: record.version,
    workspaceIdentity: record.workspaceIdentity,
    documentPath: record.documentPath,
    renderIdentity: record.renderIdentity,
    ...(record.geometryIdentity === undefined ? {} : { geometryIdentity: record.geometryIdentity }),
    capturedAtMs: record.capturedAtMs,
    width: record.width,
    height: record.height,
    mimeType: record.mimeType,
    bytesBase64: base64Encode(record.bytes),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(envelope));
  if (encoded.byteLength > MAX_ENCODED_RECORD_BYTES) throw new Error("Thumbnail record is too large.");
  return encoded;
}

export function decodeThumbnailRecord(bytes: Uint8Array): ThumbnailRecord {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_ENCODED_RECORD_BYTES) {
    throw new Error("Encoded thumbnail record is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Encoded thumbnail record is invalid JSON.");
  }
  if (!isObject(parsed)) throw new Error("Thumbnail envelope must be an object.");
  requireExactKeys(
    parsed,
    [
      "version", "workspaceIdentity", "documentPath", "renderIdentity", "capturedAtMs",
      "width", "height", "mimeType", "bytesBase64",
    ],
    ["geometryIdentity"],
  );
  const record = {
    version: parsed.version,
    workspaceIdentity: parsed.workspaceIdentity,
    documentPath: requirePath(parsed.documentPath),
    renderIdentity: parsed.renderIdentity,
    ...(parsed.geometryIdentity === undefined ? {} : { geometryIdentity: parsed.geometryIdentity }),
    capturedAtMs: parsed.capturedAtMs,
    width: parsed.width,
    height: parsed.height,
    mimeType: parsed.mimeType,
    bytes: base64Decode(parsed.bytesBase64),
  };
  validateRecord(record);
  return cloneRecord(record);
}

export function estimateThumbnailRecordBytes(record: ThumbnailRecord): number {
  validateRecord(record);
  return 128 + encodeThumbnailRecord(record).byteLength;
}

function scopedKey(workspaceIdentity: string, documentPath: ProjectPath): string {
  return JSON.stringify([workspaceIdentity, documentPath]);
}

export class InMemoryThumbnailStore {
  readonly #maxBytes: number;
  readonly #entries = new Map<string, StoredThumbnail>();
  #byteSize = 0;

  constructor(maxBytes = DEFAULT_THUMBNAIL_STORE_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error("Thumbnail store byte budget must be a non-negative safe integer.");
    }
    this.#maxBytes = maxBytes;
  }

  get byteSize(): number {
    return this.#byteSize;
  }

  get entryCount(): number {
    return this.#entries.size;
  }

  save(record: ThumbnailRecord): void {
    validateRecord(record);
    const storedRecord = cloneRecord(record);
    const key = scopedKey(storedRecord.workspaceIdentity, storedRecord.documentPath);
    const previous = this.#entries.get(key);
    if (previous) {
      this.#entries.delete(key);
      this.#byteSize -= previous.byteSize;
    }
    const byteSize = estimateThumbnailRecordBytes(storedRecord);
    if (byteSize > this.#maxBytes) return;
    this.#entries.set(key, { byteSize, record: storedRecord });
    this.#byteSize += byteSize;
    while (this.#byteSize > this.#maxBytes) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.#entries.get(oldestKey);
      this.#entries.delete(oldestKey);
      if (oldest) this.#byteSize -= oldest.byteSize;
    }
  }

  get(workspaceIdentity: string, documentPath: ProjectPath): ThumbnailRecord | undefined {
    requireIdentity(workspaceIdentity, "Workspace identity");
    const path = requirePath(documentPath);
    const key = scopedKey(workspaceIdentity, path);
    const stored = this.#entries.get(key);
    if (!stored) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, stored);
    return cloneRecord(stored.record);
  }

  listProject(workspaceIdentity: string): readonly ThumbnailRecord[] {
    requireIdentity(workspaceIdentity, "Workspace identity");
    return [...this.#entries.values()]
      .filter(({ record }) => record.workspaceIdentity === workspaceIdentity)
      .map(({ record }) => cloneRecord(record))
      .sort((left, right) => right.capturedAtMs - left.capturedAtMs
        || left.documentPath.localeCompare(right.documentPath));
  }

  newestProject(workspaceIdentity: string): ThumbnailRecord | undefined {
    return this.listProject(workspaceIdentity)[0];
  }

  move(workspaceIdentity: string, from: ProjectPath, to: ProjectPath): boolean {
    requireIdentity(workspaceIdentity, "Workspace identity");
    const fromPath = requirePath(from);
    const toPath = requirePath(to);
    const key = scopedKey(workspaceIdentity, fromPath);
    const stored = this.#entries.get(key);
    if (!stored) return false;
    this.#entries.delete(key);
    this.#byteSize -= stored.byteSize;
    this.save({ ...stored.record, documentPath: toPath });
    return true;
  }

  remove(workspaceIdentity: string, documentPath: ProjectPath): boolean {
    requireIdentity(workspaceIdentity, "Workspace identity");
    const key = scopedKey(workspaceIdentity, requirePath(documentPath));
    const stored = this.#entries.get(key);
    if (!stored) return false;
    this.#entries.delete(key);
    this.#byteSize -= stored.byteSize;
    return true;
  }
}
