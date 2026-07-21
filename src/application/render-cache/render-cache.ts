import type {
  EngineInfo,
  ParamValue,
  RenderRequest,
  RenderSuccess2D,
  RenderSuccess3D,
} from "../engine/contracts";
import { sha256GeometryIdentity } from "../geometry/geometry-identity";

export const DEFAULT_RENDER_CACHE_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_RENDER_CACHE_KEY_INDEX_LIMIT = 256;

export type CacheableRenderResult = RenderSuccess2D | RenderSuccess3D;

export interface CachedRenderResult {
  readonly tier: "memory" | "disk";
  readonly result: CacheableRenderResult;
}

export interface RenderCache {
  get(projectIdentity: string, key: string): Promise<CachedRenderResult | undefined>;
  put(projectIdentity: string, key: string, result: CacheableRenderResult): Promise<void>;
  /** Confirms and refreshes memory residency without exposing mutable cached bytes. */
  touch?(projectIdentity: string, key: string): boolean;
  /** Disk-backed tiers need a cold-start key before the first engine invocation. */
  readonly requiresColdLookup?: boolean;
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalNumber(value: number): string {
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return String(value);
}

function canonicalParameter(value: ParamValue): readonly unknown[] {
  if (Array.isArray(value)) return ["number[]", value.map(canonicalNumber)];
  if (typeof value === "number") return ["number", canonicalNumber(value)];
  if (typeof value === "boolean") return ["boolean", value];
  return ["string", value];
}

function relevantRenderFiles(request: RenderRequest): readonly [string, string | Uint8Array][] | undefined {
  const files = new Map(request.files);
  const visited = new Set<string>();
  const queue = [request.entryFile];
  const result: Array<[string, string | Uint8Array]> = [];
  const dependencyPattern = /\b(?:include|use)\s*<([^>]+)>|\bimport\s*\(\s*(?:file\s*=\s*)?["']([^"']+)["']|\bsurface\s*\(\s*(?:file\s*=\s*)?["']([^"']+)["']/gu;
  const resolve = (from: string, reference: string): string => {
    const normalized = reference.replaceAll("\\", "/");
    const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    const segments = `${base}/${normalized}`.split("/");
    const resolved: string[] = [];
    for (const segment of segments) {
      if (!segment || segment === ".") continue;
      if (segment === "..") { resolved.pop(); continue; }
      resolved.push(segment);
    }
    return resolved.join("/");
  };
  while (queue.length > 0) {
    const path = queue.shift();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const content = files.get(path);
    if (content === undefined) continue;
    result.push([path, content]);
    if (typeof content !== "string") continue;
    // Do not strip comments with a regex: quoted URLs and string literals can
    // contain comment markers. The conservative directive scan safely over-
    // invalidates in ambiguous cases instead of dropping a real asset.
    const source = content;
    // Dynamic/reordered file arguments and project-provided fonts cannot be
    // resolved completely with a lexical scan. Fall back to the complete
    // request rather than risking a stale disk-tier hit.
    if (/\b(?:import|surface)\s*\(\s*(?!(?:file\s*=\s*)?["'])/u.test(source)
      || /\btext\s*\(/u.test(source)) return [...files];
    dependencyPattern.lastIndex = 0;
    for (const match of source.matchAll(dependencyPattern)) {
      const reference = match[1] ?? match[2] ?? match[3];
      if (!reference) continue;
      const dependency = resolve(path, reference);
      const exact = files.has(dependency)
        ? dependency
        : [...files.keys()].find((candidate) => candidate.toLowerCase() === dependency.toLowerCase());
      // The engine may resolve a library outside the supplied byte map. Do
      // not guess: an unresolved dependency makes this render uncacheable.
      if (!exact) return undefined;
      queue.push(exact);
    }
  }
  return result.length > 0 ? result : [...files];
}

export async function createRenderCacheKey(
  request: RenderRequest,
  engine: EngineInfo,
  configuredEnginePath: string,
): Promise<string | undefined> {
  if (!engine.buildIdentity) return undefined;
  const files: Array<readonly [string, "text" | "binary", number, string]> = [];
  const relevantFiles = relevantRenderFiles(request);
  if (!relevantFiles) return undefined;
  for (const [path, content] of [...relevantFiles].sort(([left], [right]) => lexicalOrder(left, right))) {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const identity = await sha256GeometryIdentity(bytes);
    if (!identity) return undefined;
    files.push([path, typeof content === "string" ? "text" : "binary", bytes.byteLength, identity]);
  }
  const parameters = Object.entries(request.parameters)
    .sort(([left], [right]) => lexicalOrder(left, right))
    .map(([name, value]) => [name, canonicalParameter(value)] as const);
  const manifest = {
    schema: "scadmill-render-cache-v1",
    entryFile: request.entryFile,
    files,
    parameters,
    quality: request.quality,
    previewFacetLimit: request.quality === "preview" ? request.previewFacetLimit ?? null : null,
    engine: {
      version: engine.version,
      path: engine.path,
      features: [...engine.features].sort(lexicalOrder),
      buildIdentity: engine.buildIdentity,
      configuredPath: configuredEnginePath,
    },
  };
  return sha256GeometryIdentity(new TextEncoder().encode(JSON.stringify(manifest)));
}

function cloneDiagnostics<T extends CacheableRenderResult>(result: T): T["diagnostics"] {
  return result.diagnostics.map((diagnostic) => ({ ...diagnostic }));
}

export function cloneCacheableRenderResult(result: CacheableRenderResult): CacheableRenderResult {
  if (result.kind === "2d") {
    return {
      ...result,
      boundingBox: {
        min: [...result.boundingBox.min],
        max: [...result.boundingBox.max],
      },
      diagnostics: cloneDiagnostics(result),
    };
  }
  return {
    ...result,
    mesh: { ...result.mesh, bytes: result.mesh.bytes.slice() },
    stats: {
      ...result.stats,
      ...(result.stats.boundingBox
        ? {
            boundingBox: {
              min: [...result.stats.boundingBox.min],
              max: [...result.stats.boundingBox.max],
            },
          }
        : {}),
    },
    diagnostics: cloneDiagnostics(result),
  };
}

export function estimateRenderCacheEntryBytes(result: CacheableRenderResult): number {
  const binaryBytes = result.kind === "3d" ? result.mesh.bytes.byteLength : 0;
  const metadata = result.kind === "3d"
    ? { ...result, mesh: { ...result.mesh, bytes: undefined } }
    : result;
  return 1_024 + binaryBytes + new TextEncoder().encode(JSON.stringify(metadata)).byteLength;
}

interface MemoryEntry {
  readonly byteSize: number;
  readonly result: CacheableRenderResult;
}

export class RenderMemoryCache implements RenderCache {
  readonly #entries = new Map<string, MemoryEntry>();
  readonly #maxBytes: number;
  #byteSize = 0;

  constructor(maxBytes = DEFAULT_RENDER_CACHE_MAX_BYTES) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      throw new Error("Render cache byte budget must be a non-negative safe integer.");
    }
    this.#maxBytes = maxBytes;
  }

  get byteSize(): number {
    return this.#byteSize;
  }

  get entryCount(): number {
    return this.#entries.size;
  }

  touch(projectIdentity: string, key: string): boolean {
    const scopedKey = JSON.stringify([projectIdentity, key]);
    const entry = this.#entries.get(scopedKey);
    if (!entry) return false;
    this.#entries.delete(scopedKey);
    this.#entries.set(scopedKey, entry);
    return true;
  }

  async get(projectIdentity: string, key: string): Promise<CachedRenderResult | undefined> {
    const scopedKey = JSON.stringify([projectIdentity, key]);
    const entry = this.#entries.get(scopedKey);
    if (!entry) return undefined;
    this.#entries.delete(scopedKey);
    this.#entries.set(scopedKey, entry);
    return { tier: "memory", result: cloneCacheableRenderResult(entry.result) };
  }

  async put(projectIdentity: string, key: string, result: CacheableRenderResult): Promise<void> {
    const scopedKey = JSON.stringify([projectIdentity, key]);
    const previous = this.#entries.get(scopedKey);
    if (previous) {
      this.#entries.delete(scopedKey);
      this.#byteSize -= previous.byteSize;
    }
    const byteSize = estimateRenderCacheEntryBytes(result);
    if (byteSize > this.#maxBytes) return;
    this.#entries.set(scopedKey, { byteSize, result: cloneCacheableRenderResult(result) });
    this.#byteSize += byteSize;
    while (this.#byteSize > this.#maxBytes) {
      const oldestKey = this.#entries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      const oldest = this.#entries.get(oldestKey);
      this.#entries.delete(oldestKey);
      if (oldest) this.#byteSize -= oldest.byteSize;
    }
  }
}

export class TieredRenderCache implements RenderCache {
  readonly #memory: RenderCache;
  readonly #disk: RenderCache | undefined;
  readonly #diskEnabled: () => boolean;

  constructor(memory: RenderCache, disk?: RenderCache, diskEnabled: () => boolean = () => true) {
    this.#memory = memory;
    this.#disk = disk;
    this.#diskEnabled = diskEnabled;
  }

  get requiresColdLookup(): boolean {
    return Boolean(this.#disk && this.#diskEnabled());
  }

  touch(projectIdentity: string, key: string): boolean {
    return this.#memory.touch?.(projectIdentity, key) ?? false;
  }

  async get(projectIdentity: string, key: string): Promise<CachedRenderResult | undefined> {
    const memory = await this.#memory.get(projectIdentity, key);
    if (memory) return memory;
    if (!this.#disk || !this.#diskEnabled()) return undefined;
    let disk: CachedRenderResult | undefined;
    try {
      disk = await this.#disk.get(projectIdentity, key);
    } catch {
      return undefined;
    }
    if (!disk) return undefined;
    await this.#memory.put(projectIdentity, key, disk.result).catch(() => undefined);
    return disk;
  }

  async put(projectIdentity: string, key: string, result: CacheableRenderResult): Promise<void> {
    await this.#memory.put(projectIdentity, key, result);
    if (!this.#disk || !this.#diskEnabled()) return;
    await this.#disk.put(projectIdentity, key, result).catch(() => undefined);
  }
}

export class RenderCacheKeyIndex {
  readonly #entries = new Map<string, string>();
  readonly #maxEntries: number;

  constructor(maxEntries = DEFAULT_RENDER_CACHE_KEY_INDEX_LIMIT) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new Error("Render cache key index limit must be a non-negative safe integer.");
    }
    this.#maxEntries = maxEntries;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(memoKey: string): string | undefined {
    const key = this.#entries.get(memoKey);
    if (key === undefined) return undefined;
    this.#entries.delete(memoKey);
    this.#entries.set(memoKey, key);
    return key;
  }

  set(memoKey: string, cacheKey: string): void {
    this.#entries.delete(memoKey);
    this.#entries.set(memoKey, cacheKey);
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#entries.delete(oldest);
    }
  }

  delete(memoKey: string): void {
    this.#entries.delete(memoKey);
  }
}
