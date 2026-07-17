import type {
  OpenScadWasmArtifactCache,
  StoredOpenScadWasmBundle,
} from "./openscad-wasm-cache";
import {
  createOpenScadWasmRuntime,
  type OpenScadWasmRuntime,
  type OpenScadWasmRuntimeOptions,
} from "./openscad-wasm-runtime";

type ArtifactName = "openscad.js" | "openscad.wasm";

export interface OpenScadWasmArtifact {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export const OPENSCAD_WASM_ARTIFACTS = {
  "openscad.js": {
    path: "2026.06.12/openscad.js",
    sha256: "E458673D46D506D77B780C526D6E5492250F353D582057C6F912724A9586D86E",
    bytes: 100_027,
  },
  "openscad.wasm": {
    path: "2026.06.12/openscad.wasm",
    sha256: "F908AAFA32FEBE9A3A20F76ACA6B8101051BF2FC7655F094F18C6D99B52683EA",
    bytes: 10_760_714,
  },
} as const satisfies Readonly<Record<ArtifactName, OpenScadWasmArtifact>>;

export interface OpenScadWasmProgress {
  readonly asset: ArtifactName;
  readonly loadedBytes: number;
  readonly totalBytes: number | null;
}

export interface OpenScadWasmLoaderOptions {
  readonly artifactBaseUrl: string | URL;
  readonly cache?: OpenScadWasmArtifactCache;
  readonly onProgress?: (progress: OpenScadWasmProgress) => void;
  readonly signal?: AbortSignal;
}

interface LoaderCrypto {
  readonly subtle: {
    digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer>;
  };
}

export interface OpenScadWasmLoaderEnvironment {
  /** Test seam; production always uses OPENSCAD_WASM_ARTIFACTS. */
  readonly artifacts?: Readonly<Record<ArtifactName, OpenScadWasmArtifact>>;
  readonly fetch: typeof globalThis.fetch;
  readonly crypto: LoaderCrypto;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
  readonly importModule: (url: string) => Promise<unknown>;
  readonly createRuntime: (
    namespace: unknown,
    options: OpenScadWasmRuntimeOptions,
  ) => Promise<OpenScadWasmRuntime>;
}

interface DownloadedAsset {
  readonly name: ArtifactName;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

type DownloadedPair = readonly [DownloadedAsset, DownloadedAsset];

class OpenScadWasmIntegrityError extends Error {}

function defaultEnvironment(): OpenScadWasmLoaderEnvironment {
  return {
    artifacts: OPENSCAD_WASM_ARTIFACTS,
    fetch: globalThis.fetch.bind(globalThis),
    crypto: globalThis.crypto,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    importModule: (url) => import(/* @vite-ignore */ url) as Promise<unknown>,
    createRuntime: createOpenScadWasmRuntime,
  };
}

function artifactUrls(
  baseValue: string | URL,
  artifacts: Readonly<Record<ArtifactName, OpenScadWasmArtifact>>,
): Readonly<Record<ArtifactName, string>> {
  let base: URL;
  try {
    base = new URL(baseValue);
  } catch {
    throw new Error("The OpenSCAD artifact base must be an absolute HTTP(S) URL.");
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("The OpenSCAD artifact base must be an absolute HTTP(S) URL.");
  }
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return {
    "openscad.js": new URL(artifacts["openscad.js"].path, base).href,
    "openscad.wasm": new URL(artifacts["openscad.wasm"].path, base).href,
  };
}

function notify(
  observer: OpenScadWasmLoaderOptions["onProgress"],
  progress: OpenScadWasmProgress,
): void {
  try {
    observer?.(progress);
  } catch {
    // Progress observers are outside the verified engine-loading lifecycle.
  }
}

function joinChunks(chunks: readonly Uint8Array[], length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function download(
  name: ArtifactName,
  url: string,
  options: OpenScadWasmLoaderOptions,
  environment: OpenScadWasmLoaderEnvironment,
  artifacts: Readonly<Record<ArtifactName, OpenScadWasmArtifact>>,
): Promise<DownloadedAsset> {
  const response = await environment.fetch(url, {
    cache: "force-cache",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`OpenSCAD engine asset ${name} failed with HTTP ${response.status}.`);
  }
  const expectedBytes = artifacts[name].bytes;
  const totalBytes = expectedBytes;
  let bytes: Uint8Array<ArrayBuffer>;
  if (!response.body) {
    bytes = new Uint8Array(await response.arrayBuffer());
    notify(options.onProgress, { asset: name, loadedBytes: bytes.byteLength, totalBytes });
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loadedBytes = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (loadedBytes + result.value.byteLength > expectedBytes) {
          try {
            await reader.cancel();
          } catch {
            // Preserve the fail-closed length error if stream cancellation itself fails.
          }
          throw new Error(
            `OpenSCAD engine asset ${name} exceeded its pinned length ${expectedBytes}.`,
          );
        }
        chunks.push(result.value.slice());
        loadedBytes += result.value.byteLength;
        notify(options.onProgress, { asset: name, loadedBytes, totalBytes });
      }
    } finally {
      reader.releaseLock();
    }
    bytes = joinChunks(chunks, loadedBytes);
  }
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `OpenSCAD engine asset ${name} has length ${bytes.byteLength}; expected ${expectedBytes}.`,
    );
  }
  return { name, bytes };
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function verify(
  artifact: DownloadedAsset,
  environment: OpenScadWasmLoaderEnvironment,
  artifacts: Readonly<Record<ArtifactName, OpenScadWasmArtifact>>,
): Promise<void> {
  const digest = await environment.crypto.subtle.digest("SHA-256", artifact.bytes);
  const actual = hex(new Uint8Array(digest));
  const expected = artifacts[artifact.name].sha256;
  if (actual !== expected) {
    throw new OpenScadWasmIntegrityError(
      `OpenSCAD engine asset ${artifact.name} failed SHA-256 verification.`,
    );
  }
}

export function openScadWasmArtifactCacheKey(
  artifacts: Readonly<Record<ArtifactName, OpenScadWasmArtifact>>,
): string {
  return JSON.stringify([
    "scadmill-openscad-wasm-v1",
    artifacts["openscad.js"].path,
    artifacts["openscad.js"].bytes,
    artifacts["openscad.js"].sha256,
    artifacts["openscad.wasm"].path,
    artifacts["openscad.wasm"].bytes,
    artifacts["openscad.wasm"].sha256,
  ]);
}

export const OPENSCAD_WASM_CACHE_KEY = openScadWasmArtifactCacheKey(OPENSCAD_WASM_ARTIFACTS);

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The OpenSCAD engine load was aborted.", "AbortError");
}

function cachedAsset(
  name: ArtifactName,
  bytes: Uint8Array,
  artifacts: Readonly<Record<ArtifactName, OpenScadWasmArtifact>>,
): DownloadedAsset {
  if (bytes.byteLength !== artifacts[name].bytes) {
    throw new OpenScadWasmIntegrityError(
      `Cached OpenSCAD engine asset ${name} has an invalid length.`,
    );
  }
  return { name, bytes: bytes.slice() };
}

async function verifiedCachedPair(
  cache: OpenScadWasmArtifactCache,
  key: string,
  artifacts: Readonly<Record<ArtifactName, OpenScadWasmArtifact>>,
  options: OpenScadWasmLoaderOptions,
  environment: OpenScadWasmLoaderEnvironment,
): Promise<DownloadedPair | null> {
  let stored: StoredOpenScadWasmBundle | null;
  try {
    stored = await cache.read(key);
  } catch {
    return null;
  }
  if (stored === null) return null;
  try {
    throwIfAborted(options.signal);
    if (stored.key !== key) {
      throw new OpenScadWasmIntegrityError("Cached OpenSCAD engine identity mismatch.");
    }
    const javascript = cachedAsset("openscad.js", stored.javascript, artifacts);
    const wasm = cachedAsset("openscad.wasm", stored.wasm, artifacts);
    await Promise.all([
      verify(javascript, environment, artifacts),
      verify(wasm, environment, artifacts),
    ]);
    throwIfAborted(options.signal);
    notify(options.onProgress, {
      asset: "openscad.js",
      loadedBytes: javascript.bytes.byteLength,
      totalBytes: artifacts["openscad.js"].bytes,
    });
    notify(options.onProgress, {
      asset: "openscad.wasm",
      loadedBytes: wasm.bytes.byteLength,
      totalBytes: artifacts["openscad.wasm"].bytes,
    });
    return [javascript, wasm];
  } catch (error) {
    if (!(error instanceof OpenScadWasmIntegrityError)) throw error;
    try {
      await cache.remove(key);
    } catch {
      // A failed eviction cannot make unverified cached bytes executable.
    }
    return null;
  }
}

async function storeVerifiedPair(
  cache: OpenScadWasmArtifactCache | undefined,
  key: string,
  javascript: DownloadedAsset,
  wasm: DownloadedAsset,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.write({
      key,
      javascript: javascript.bytes.slice(),
      wasm: wasm.bytes.slice(),
    });
  } catch {
    // Cache availability never weakens a currently verified online load.
  }
}

async function importVerifiedJavascript(
  bytes: Uint8Array<ArrayBuffer>,
  environment: OpenScadWasmLoaderEnvironment,
): Promise<unknown> {
  const objectUrl = environment.createObjectUrl(
    new Blob([bytes], { type: "text/javascript;charset=utf-8" }),
  );
  if (!objectUrl) throw new Error("The verified OpenSCAD JavaScript object URL is invalid.");
  try {
    return await environment.importModule(objectUrl);
  } finally {
    try {
      environment.revokeObjectUrl(objectUrl);
    } catch {
      // Revocation cleanup must not replace the import outcome.
    }
  }
}

export async function loadVerifiedOpenScadWasm(
  options: OpenScadWasmLoaderOptions,
  environment: OpenScadWasmLoaderEnvironment = defaultEnvironment(),
): Promise<OpenScadWasmRuntime> {
  throwIfAborted(options.signal);
  const artifacts = Object.hasOwn(environment, "artifacts") && environment.artifacts
    ? environment.artifacts
    : OPENSCAD_WASM_ARTIFACTS;
  const key = openScadWasmArtifactCacheKey(artifacts);
  const urls = artifactUrls(options.artifactBaseUrl, artifacts);
  const cached = options.cache
    ? await verifiedCachedPair(options.cache, key, artifacts, options, environment)
    : null;
  const [javascript, wasm] = cached ?? await Promise.all([
    download("openscad.js", urls["openscad.js"], options, environment, artifacts),
    download("openscad.wasm", urls["openscad.wasm"], options, environment, artifacts),
  ]);
  if (!cached) {
    await Promise.all([
      verify(javascript, environment, artifacts),
      verify(wasm, environment, artifacts),
    ]);
    await storeVerifiedPair(options.cache, key, javascript, wasm);
  }

  throwIfAborted(options.signal);
  const namespace = await importVerifiedJavascript(javascript.bytes, environment);
  const wasmObjectUrl = environment.createObjectUrl(
    new Blob([wasm.bytes], { type: "application/wasm" }),
  );
  if (!wasmObjectUrl) throw new Error("The verified OpenSCAD WASM object URL is invalid.");
  try {
    return await environment.createRuntime(namespace, {
      wasmBinary: wasm.bytes.slice(),
      locateFile: (path) => {
        if (path !== "openscad.wasm") {
          throw new Error(`OpenSCAD requested an unexpected engine asset: ${path}`);
        }
        return wasmObjectUrl;
      },
    });
  } finally {
    try {
      environment.revokeObjectUrl(wasmObjectUrl);
    } catch {
      // Revocation cleanup must not replace the runtime-construction outcome.
    }
  }
}
