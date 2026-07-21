import type { CacheableRenderResult, CachedRenderResult, RenderCache } from "./render-cache";
import type { MeshFormat } from "../engine/contracts";
import { cloneCacheableRenderResult } from "./render-cache";
import {
  isSha256GeometryIdentity,
  sha256GeometryIdentity,
} from "../geometry/geometry-identity";

const ENVELOPE_SCHEMA = "scadmill-render-cache-entry-v1";
const INTEGRITY_SCHEMA = "scadmill-render-cache-integrity-v1";

export interface RenderDiskCacheRecord {
  readonly key: string;
  readonly byteSize: number;
  readonly lastAccessMs: number;
}

/** Platform-owned opaque storage. Implementations must keep bytes out of project roots. */
export interface RenderDiskCacheStorage {
  read(projectIdentity: string, key: string): Promise<Uint8Array | undefined>;
  write(projectIdentity: string, key: string, bytes: Uint8Array, maxBytes?: number): Promise<void>;
  remove(projectIdentity: string, key: string): Promise<void>;
  list(projectIdentity: string): Promise<readonly RenderDiskCacheRecord[]>;
  touch?(projectIdentity: string, key: string, atMs: number): Promise<void>;
  clear?(projectIdentity: string): Promise<void>;
}

export const DEFAULT_RENDER_DISK_CACHE_MAX_BYTES = 512 * 1024 * 1024;
/** Keeps JSON IPC payloads bounded; larger geometry remains memory-only. */
export const DEFAULT_RENDER_DISK_CACHE_MAX_RECORD_BYTES = 4 * 1024 * 1024;
export const RENDER_DISK_CACHE_METADATA_RESERVE_BYTES = 256;

function estimatedRawResultBytes(result: CacheableRenderResult): number {
  // Use string lengths rather than TextEncoder/JSON so hostile or accidental
  // oversized logs/diagnostics cannot force a large temporary allocation.
  const strings = result.diagnostics.reduce((total, diagnostic) => total
    + diagnostic.message.length
    + (diagnostic.file?.length ?? 0), 0)
    + result.rawLog.length;
  const textBytes = strings * 4;
  if (result.kind === "2d") return textBytes + result.svg.length * 4;
  return textBytes + result.mesh.bytes.byteLength;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function decodeBase64(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const binary = globalThis.atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function finiteTuple(value: unknown, length: number): value is number[] {
  return Array.isArray(value)
    && value.length === length
    && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function validDiagnostic(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const diagnostic = value as Record<string, unknown>;
  return ["error", "warning", "echo", "trace", "info"].includes(diagnostic.severity as string)
    && typeof diagnostic.message === "string"
    && (diagnostic.file === undefined || typeof diagnostic.file === "string")
    && (diagnostic.line === undefined || (Number.isSafeInteger(diagnostic.line) && (diagnostic.line as number) > 0));
}

function validDiagnostics(value: unknown): value is CacheableRenderResult["diagnostics"] {
  return Array.isArray(value) && value.every(validDiagnostic);
}

function validNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function decodeResult(value: unknown): CacheableRenderResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "2d") {
    const bounds = candidate.boundingBox;
    if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return undefined;
    const box = bounds as Record<string, unknown>;
    if (!finiteTuple(box.min, 2) || !finiteTuple(box.max, 2)) return undefined;
    if (typeof candidate.svg !== "string" || typeof candidate.rawLog !== "string" || !validDiagnostics(candidate.diagnostics)) return undefined;
    if (typeof candidate.geometryIdentity !== "undefined" && typeof candidate.geometryIdentity !== "string") return undefined;
    return {
      kind: "2d",
      svg: candidate.svg,
      ...(typeof candidate.geometryIdentity === "string" ? { geometryIdentity: candidate.geometryIdentity } : {}),
      boundingBox: { min: [box.min[0], box.min[1]], max: [box.max[0], box.max[1]] },
      diagnostics: candidate.diagnostics,
      rawLog: candidate.rawLog,
    };
  }
  if (candidate.kind !== "3d" || !candidate.mesh || typeof candidate.mesh !== "object" || Array.isArray(candidate.mesh)) return undefined;
  const mesh = candidate.mesh as Record<string, unknown>;
  const bytes = decodeBase64(mesh.bytes);
  const stats = candidate.stats;
  if (!bytes || typeof mesh.format !== "string" || !stats || typeof stats !== "object" || Array.isArray(stats) || typeof candidate.rawLog !== "string" || !validDiagnostics(candidate.diagnostics)) return undefined;
  const parsedStats = stats as Record<string, unknown>;
  const boundingBox = parsedStats.boundingBox;
  const parsedBounds = boundingBox && typeof boundingBox === "object" && !Array.isArray(boundingBox)
    ? boundingBox as Record<string, unknown>
    : undefined;
  if (parsedBounds && (!finiteTuple(parsedBounds.min, 3) || !finiteTuple(parsedBounds.max, 3))) return undefined;
  if (boundingBox !== undefined && !parsedBounds) return undefined;
  if (typeof mesh.geometryIdentity !== "undefined" && typeof mesh.geometryIdentity !== "string") return undefined;
  if (typeof parsedStats.engineTimeMs !== "number"
    || !Number.isFinite(parsedStats.engineTimeMs)
    || parsedStats.engineTimeMs < 0
    || (parsedStats.vertices !== undefined && !validNonNegativeInteger(parsedStats.vertices))
    || (parsedStats.triangles !== undefined && !validNonNegativeInteger(parsedStats.triangles))
    || (parsedStats.volumeMm3 !== undefined && !(typeof parsedStats.volumeMm3 === "number" && Number.isFinite(parsedStats.volumeMm3) && parsedStats.volumeMm3 >= 0))) return undefined;
  const meshFormats: readonly MeshFormat[] = ["stl-binary", "stl-ascii", "3mf", "off", "amf"];
  if (!meshFormats.includes(mesh.format as MeshFormat)) return undefined;
  const min = parsedBounds?.min as number[] | undefined;
  const max = parsedBounds?.max as number[] | undefined;
  return {
    kind: "3d",
    mesh: {
      format: mesh.format as MeshFormat,
      bytes,
      ...(typeof mesh.geometryIdentity === "string" ? { geometryIdentity: mesh.geometryIdentity } : {}),
    },
    stats: {
      ...(typeof parsedStats.vertices === "number" ? { vertices: parsedStats.vertices } : {}),
      ...(typeof parsedStats.triangles === "number" ? { triangles: parsedStats.triangles } : {}),
      ...(parsedBounds && min && max ? { boundingBox: { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] } } : {}),
      ...(typeof parsedStats.volumeMm3 === "number" ? { volumeMm3: parsedStats.volumeMm3 } : {}),
      engineTimeMs: parsedStats.engineTimeMs as number,
    },
    diagnostics: candidate.diagnostics,
    rawLog: candidate.rawLog,
  };
}

function recordObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function digestPayload(payload: Record<string, unknown>): Promise<string | undefined> {
  try {
    return await sha256GeometryIdentity(
      new TextEncoder().encode(JSON.stringify(payload)),
    );
  } catch {
    return undefined;
  }
}

async function encodeResult(
  projectIdentity: string,
  key: string,
  result: CacheableRenderResult,
): Promise<Uint8Array | undefined> {
  const serializable = result.kind === "3d"
    ? { ...result, mesh: { ...result.mesh, bytes: encodeBase64(result.mesh.bytes) } }
    : result;
  const payload = { projectIdentity, key, result: serializable };
  const digest = await digestPayload(payload);
  if (!digest) return undefined;
  return new TextEncoder().encode(JSON.stringify({
    schema: ENVELOPE_SCHEMA,
    integrity: { schema: INTEGRITY_SCHEMA, digest },
    payload,
  }));
}

export class RenderDiskCache implements RenderCache {
  readonly #storage: RenderDiskCacheStorage;
  readonly #maxBytes: number;
  readonly #maxRecordBytes: number;
  readonly #now: () => number;
  readonly #putTails = new Map<string, Promise<void>>();
  readonly #generations = new Map<string, number>();

  constructor(
    storage: RenderDiskCacheStorage,
    options: { maxBytes?: number; maxRecordBytes?: number; now?: () => number } = {},
  ) {
    this.#storage = storage;
    this.#maxBytes = options.maxBytes ?? DEFAULT_RENDER_DISK_CACHE_MAX_BYTES;
    this.#maxRecordBytes = options.maxRecordBytes ?? DEFAULT_RENDER_DISK_CACHE_MAX_RECORD_BYTES;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 0) {
      throw new Error("Render disk cache byte budget must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(this.#maxRecordBytes) || this.#maxRecordBytes < 0) {
      throw new Error("Render disk cache record budget must be a non-negative safe integer.");
    }
  }

  async get(projectIdentity: string, key: string): Promise<CachedRenderResult | undefined> {
    let bytes: Uint8Array | undefined;
    try {
      bytes = await this.#storage.read(projectIdentity, key);
    } catch {
      return undefined;
    }
    if (!bytes) return undefined;
    const removeCorrupt = () => this.#storage.remove(projectIdentity, key).catch(() => undefined);
    if (bytes.byteLength > this.#maxBytes || bytes.byteLength > this.#maxRecordBytes) {
      await removeCorrupt();
      return undefined;
    }
    try {
      const envelope = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      if (!recordObject(envelope) || envelope.schema !== ENVELOPE_SCHEMA) {
        await removeCorrupt();
        return undefined;
      }
      const integrity = envelope.integrity;
      const payload = envelope.payload;
      if (!recordObject(integrity)
        || integrity.schema !== INTEGRITY_SCHEMA
        || !isSha256GeometryIdentity(integrity.digest)
        || !recordObject(payload)) {
        await removeCorrupt();
        return undefined;
      }
      const actualDigest = await digestPayload(payload);
      if (actualDigest !== integrity.digest
        || payload.projectIdentity !== projectIdentity
        || payload.key !== key) {
        await removeCorrupt();
        return undefined;
      }
      const result = decodeResult(payload.result);
      if (!result) {
        await removeCorrupt();
        return undefined;
      }
      if (this.#storage.touch) {
        void this.#storage.touch(projectIdentity, key, this.#now()).catch(() => undefined);
      }
      return { tier: "disk", result: cloneCacheableRenderResult(result) };
    } catch {
      await removeCorrupt();
      return undefined;
    }
  }

  async put(projectIdentity: string, key: string, result: CacheableRenderResult): Promise<void> {
    const generation = this.#generations.get(projectIdentity) ?? 0;
    if (!this.#generations.has(projectIdentity)) this.#generations.set(projectIdentity, generation);
    const previous = this.#putTails.get(projectIdentity) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if (this.#generations.get(projectIdentity) !== generation) return;
      // Reject oversized raw payloads before base64/JSON encoding. This keeps a
      // large mesh from creating transient renderer-thread allocations merely
      // to discover that it cannot fit the IPC-safe record cap.
      if (estimatedRawResultBytes(result) > this.#maxRecordBytes) return;
      let bytes: Uint8Array | undefined;
      try { bytes = await encodeResult(projectIdentity, key, result); } catch { return; }
      if (!bytes) return;
      if (bytes.byteLength > this.#maxBytes || bytes.byteLength > this.#maxRecordBytes) return;
      let records: RenderDiskCacheRecord[];
      try {
        const listed = [...await this.#storage.list(projectIdentity)];
        for (const record of listed) {
          if (record.key !== key && (!Number.isSafeInteger(record.byteSize) || record.byteSize < 0 || !Number.isSafeInteger(record.lastAccessMs) || record.lastAccessMs < 0)) {
            const removed = await this.#storage.remove(projectIdentity, record.key).then(() => true).catch(() => false);
            if (!removed) return;
          }
        }
        records = listed.filter((record) => record.key !== key && Number.isSafeInteger(record.byteSize) && record.byteSize >= 0 && Number.isSafeInteger(record.lastAccessMs) && record.lastAccessMs >= 0);
      } catch { return; }
    let total = bytes.byteLength + RENDER_DISK_CACHE_METADATA_RESERVE_BYTES
      + records.reduce((sum, record) => sum + record.byteSize, 0);
      records.sort((left, right) => left.lastAccessMs - right.lastAccessMs);
      for (const record of records) {
        if (total <= this.#maxBytes) break;
        const removed = await this.#storage.remove(projectIdentity, record.key).then(() => true).catch(() => false);
        if (!removed) return;
        total -= record.byteSize;
      }
      await this.#storage.write(projectIdentity, key, bytes, this.#maxBytes).catch(() => undefined);
    });
    this.#putTails.set(projectIdentity, current);
    await current;
    if (this.#putTails.get(projectIdentity) === current) this.#putTails.delete(projectIdentity);
  }

  async clear(projectIdentity: string): Promise<void> {
    this.#generations.set(projectIdentity, (this.#generations.get(projectIdentity) ?? 0) + 1);
    const previous = this.#putTails.get(projectIdentity) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if (this.#storage.clear) {
        await this.#storage.clear(projectIdentity);
        return;
      }
      const records = await this.#storage.list(projectIdentity);
      await Promise.all(records.map((record) => this.#storage.remove(projectIdentity, record.key)));
    });
    this.#putTails.set(projectIdentity, current);
    await current;
    if (this.#putTails.get(projectIdentity) === current) this.#putTails.delete(projectIdentity);
  }
}
