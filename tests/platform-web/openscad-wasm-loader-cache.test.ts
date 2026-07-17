import { describe, expect, it, vi } from "vitest";

import type {
  OpenScadWasmArtifactCache,
  StoredOpenScadWasmBundle,
} from "../../src/platform-web/openscad-wasm-cache";
import {
  loadVerifiedOpenScadWasm,
  OPENSCAD_WASM_ARTIFACTS,
  OPENSCAD_WASM_CACHE_KEY,
  type OpenScadWasmLoaderEnvironment,
  type OpenScadWasmProgress,
  openScadWasmArtifactCacheKey,
} from "../../src/platform-web/openscad-wasm-loader";
import type { OpenScadWasmRuntime } from "../../src/platform-web/openscad-wasm-runtime";

const encoder = new TextEncoder();
const javascript = encoder.encode("verified-js");
const wasm = encoder.encode("verified-wasm");
const artifacts = {
  "openscad.js": { path: "test/openscad.js", sha256: "11".repeat(32), bytes: javascript.length },
  "openscad.wasm": { path: "test/openscad.wasm", sha256: "22".repeat(32), bytes: wasm.length },
} as const;
const runtime = { version: vi.fn(), render: vi.fn(), export: vi.fn() } as unknown as OpenScadWasmRuntime;

function hashBytes(value: string): ArrayBuffer {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) => (
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  )).buffer;
}

function environment(options: {
  readonly fetch?: typeof fetch;
  readonly badNetworkHash?: boolean;
} = {}) {
  const blobs = new Map<string, Blob>();
  const events: string[] = [];
  let sequence = 0;
  const fetch_ = options.fetch ?? vi.fn(async (url: string | URL | Request) => new Response(
    String(url).endsWith("openscad.js") ? javascript : wasm,
  ));
  const value: OpenScadWasmLoaderEnvironment = {
    artifacts,
    fetch: fetch_,
    crypto: {
      subtle: {
        digest: vi.fn(async (_algorithm, source) => {
          const bytes = source instanceof ArrayBuffer
            ? new Uint8Array(source)
            : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
          const expected = bytes.byteLength === javascript.length ? javascript : wasm;
          const exact = bytes.every((byte, index) => byte === expected[index]);
          if (options.badNetworkHash) return hashBytes("00".repeat(32));
          events.push(`digest:${bytes.byteLength === javascript.length ? "js" : "wasm"}`);
          return hashBytes(exact && bytes.byteLength === javascript.length
            ? artifacts["openscad.js"].sha256
            : exact
              ? artifacts["openscad.wasm"].sha256
              : "00".repeat(32));
        }),
      },
    },
    createObjectUrl: (blob) => {
      const url = `blob:cache-test-${++sequence}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectUrl: vi.fn(),
    importModule: vi.fn(async () => {
      events.push("import");
      return { default: "verified" };
    }),
    createRuntime: vi.fn(async () => {
      events.push("runtime");
      return runtime;
    }),
  };
  return { value, fetch: fetch_, blobs, events };
}

function cache(options: {
  readonly record?: StoredOpenScadWasmBundle | null;
  readonly readError?: Error;
  readonly writeError?: Error;
} = {}) {
  const read = vi.fn(async (_key: string): Promise<StoredOpenScadWasmBundle | null> => {
    if (options.readError) throw options.readError;
    return options.record ?? null;
  });
  const write = vi.fn(async (_bundle: StoredOpenScadWasmBundle) => {
    if (options.writeError) throw options.writeError;
  });
  const remove = vi.fn(async (_key: string) => undefined);
  return { value: { read, write, remove } satisfies OpenScadWasmArtifactCache, read, write, remove };
}

function bundle(key: string, javascriptBytes = javascript, wasmBytes = wasm): StoredOpenScadWasmBundle {
  return { key, javascript: javascriptBytes.slice(), wasm: wasmBytes.slice() };
}

describe("verified OpenSCAD WASM loader cache integration", () => {
  it("binds the cache identity to both exact paths, lengths, and hashes", () => {
    expect(JSON.parse(OPENSCAD_WASM_CACHE_KEY)).toEqual([
      "scadmill-openscad-wasm-v1",
      OPENSCAD_WASM_ARTIFACTS["openscad.js"].path,
      OPENSCAD_WASM_ARTIFACTS["openscad.js"].bytes,
      OPENSCAD_WASM_ARTIFACTS["openscad.js"].sha256,
      OPENSCAD_WASM_ARTIFACTS["openscad.wasm"].path,
      OPENSCAD_WASM_ARTIFACTS["openscad.wasm"].bytes,
      OPENSCAD_WASM_ARTIFACTS["openscad.wasm"].sha256,
    ]);
    for (const [name, field, value] of [
      ["openscad.js", "path", "changed/openscad.js"],
      ["openscad.js", "bytes", 99],
      ["openscad.js", "sha256", "AA".repeat(32)],
      ["openscad.wasm", "path", "changed/openscad.wasm"],
      ["openscad.wasm", "bytes", 100],
      ["openscad.wasm", "sha256", "BB".repeat(32)],
    ] as const) {
      const changed = {
        ...artifacts,
        [name]: { ...artifacts[name], [field]: value },
      };
      expect(openScadWasmArtifactCacheKey(changed)).not.toBe(
        openScadWasmArtifactCacheKey(artifacts),
      );
    }
  });

  it("loads a valid verified pair offline without contacting the network", async () => {
    const setup = environment({ fetch: vi.fn(async () => { throw new Error("offline"); }) });
    const storage = cache();
    storage.read.mockImplementationOnce(async (key) => bundle(key));
    const progress: OpenScadWasmProgress[] = [];

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
      onProgress: (event) => progress.push(event),
    }, setup.value)).resolves.toBe(runtime);

    expect(setup.fetch).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(setup.value.crypto.subtle.digest).toHaveBeenCalledTimes(2);
    expect(setup.events).toEqual(["digest:js", "digest:wasm", "import", "runtime"]);
    expect(progress).toEqual(expect.arrayContaining([
      { asset: "openscad.js", loadedBytes: javascript.length, totalBytes: javascript.length },
      { asset: "openscad.wasm", loadedBytes: wasm.length, totalBytes: wasm.length },
    ]));
  });

  it("honors an already-aborted signal before reading or executing cached bytes", async () => {
    const setup = environment();
    const storage = cache();
    storage.read.mockImplementationOnce(async (key) => bundle(key));
    const controller = new AbortController();
    controller.abort();
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
      signal: controller.signal,
    }, setup.value)).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.read).not.toHaveBeenCalled();
    expect(setup.value.importModule).not.toHaveBeenCalled();
  });

  it("writes one verified network pair and never caches a failed verification", async () => {
    const setup = environment();
    const storage = cache();
    await loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
    }, setup.value);
    expect(storage.write).toHaveBeenCalledOnce();
    expect(storage.write.mock.calls[0]?.[0]).toMatchObject({
      javascript,
      wasm,
    });

    const badSetup = environment({ badNetworkHash: true });
    const unused = cache();
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: unused.value,
    }, badSetup.value)).rejects.toThrow(/SHA-256/u);
    expect(unused.write).not.toHaveBeenCalled();
  });

  it("evicts a corrupt cached pair and refreshes both assets from the network", async () => {
    const setup = environment();
    const storage = cache();
    storage.read.mockImplementationOnce(async (key) => bundle(
      key,
      javascript.slice(0, -1),
      new Uint8Array([99]),
    ));

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
    }, setup.value)).resolves.toBe(runtime);
    expect(storage.remove).toHaveBeenCalledOnce();
    expect(setup.fetch).toHaveBeenCalledTimes(2);
    expect(storage.write).toHaveBeenCalledOnce();
  });

  it("does not execute corrupt cached bytes when the full-pair refresh is offline", async () => {
    const setup = environment({ fetch: vi.fn(async () => { throw new Error("offline"); }) });
    const storage = cache();
    storage.read.mockImplementationOnce(async (key) => bundle(key, new Uint8Array([0]), wasm));

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
    }, setup.value)).rejects.toThrow(/offline/u);
    expect(storage.remove).toHaveBeenCalledOnce();
    expect(setup.value.importModule).not.toHaveBeenCalled();
  });

  it("freshly hashes same-length cached bytes and reports no completion for a rejected pair", async () => {
    const setup = environment({ fetch: vi.fn(async () => { throw new Error("offline"); }) });
    const storage = cache();
    const tampered = javascript.slice();
    tampered[0] ^= 0xff;
    storage.read.mockImplementationOnce(async (key) => bundle(key, tampered, wasm));
    const progress: OpenScadWasmProgress[] = [];
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
      onProgress: (event) => progress.push(event),
    }, setup.value)).rejects.toThrow(/offline/u);
    expect(setup.value.crypto.subtle.digest).toHaveBeenCalledTimes(2);
    expect(storage.remove).toHaveBeenCalledOnce();
    expect(progress).toEqual([]);
    expect(setup.value.importModule).not.toHaveBeenCalled();
  });

  it("preserves the only cached pair when WebCrypto itself fails", async () => {
    const setup = environment({ fetch: vi.fn(async () => { throw new Error("offline"); }) });
    const storage = cache();
    storage.read.mockImplementationOnce(async (key) => bundle(key));
    vi.mocked(setup.value.crypto.subtle.digest).mockRejectedValueOnce(
      new Error("WebCrypto unavailable"),
    );
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
    }, setup.value)).rejects.toThrow(/WebCrypto unavailable/u);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(setup.value.importModule).not.toHaveBeenCalled();
  });

  it("falls back on cache read failure and does not reject a verified load on write failure", async () => {
    const setup = environment();
    const storage = cache({ readError: new Error("denied"), writeError: new Error("quota") });
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/",
      cache: storage.value,
    }, setup.value)).resolves.toBe(runtime);
    expect(setup.fetch).toHaveBeenCalledTimes(2);
    expect(storage.write).toHaveBeenCalledOnce();
  });
});
