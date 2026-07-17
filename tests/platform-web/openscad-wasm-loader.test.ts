import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  loadVerifiedOpenScadWasm,
  OPENSCAD_WASM_ARTIFACTS,
  type OpenScadWasmLoaderEnvironment,
  type OpenScadWasmProgress,
} from "../../src/platform-web/openscad-wasm-loader";
import type { OpenScadWasmRuntime } from "../../src/platform-web/openscad-wasm-runtime";

const encoder = new TextEncoder();
const javascriptBytes = encoder.encode("export default async function OpenSCAD() {}\n");
const wasmBytes = encoder.encode("wasm-fixture");
const TEST_ARTIFACTS = {
  "openscad.js": {
    path: OPENSCAD_WASM_ARTIFACTS["openscad.js"].path,
    sha256: "11".repeat(32),
    bytes: javascriptBytes.byteLength,
  },
  "openscad.wasm": {
    path: OPENSCAD_WASM_ARTIFACTS["openscad.wasm"].path,
    sha256: "22".repeat(32),
    bytes: wasmBytes.byteLength,
  },
} as const;
const runtime = { version: vi.fn(), render: vi.fn(), export: vi.fn() } as unknown as OpenScadWasmRuntime;

function bytesFromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function fixtureResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes.slice(), {
    status,
    headers: { "content-length": String(bytes.byteLength) },
  });
}

function environment(options: {
  readonly badHashFor?: "openscad.js" | "openscad.wasm";
  readonly fetch?: typeof fetch;
  readonly importModule?: (url: string) => Promise<unknown>;
  readonly onDigest?: (asset: string, source: BufferSource) => void;
  readonly createRuntime?: OpenScadWasmLoaderEnvironment["createRuntime"];
} = {}): {
  readonly value: OpenScadWasmLoaderEnvironment;
  readonly blobs: Map<string, Blob>;
  readonly revoked: ReturnType<typeof vi.fn>;
  readonly createRuntime: ReturnType<typeof vi.fn>;
} {
  const blobs = new Map<string, Blob>();
  const revoked = vi.fn();
  const createRuntime = vi.fn(options.createRuntime ?? (async () => runtime));
  const fetch_ = options.fetch ?? vi.fn(async (url: string | URL | Request) =>
    fixtureResponse(String(url).endsWith("openscad.js") ? javascriptBytes : wasmBytes));
  const importModule = vi.fn(
    options.importModule ?? (async (url: string) => ({ default: await blobs.get(url)?.text() })),
  );
  let objectSequence = 0;

  return {
    blobs,
    revoked,
    createRuntime,
    value: {
      artifacts: TEST_ARTIFACTS,
      fetch: fetch_,
      crypto: {
        subtle: {
          digest: vi.fn(async (_algorithm: AlgorithmIdentifier, data: BufferSource) => {
            const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
            const asset = bytes.byteLength === javascriptBytes.byteLength
              ? "openscad.js"
              : "openscad.wasm";
            options.onDigest?.(asset, data);
            const hash = options.badHashFor === asset
              ? "00".repeat(32)
              : TEST_ARTIFACTS[asset].sha256;
            return bytesFromHex(hash).buffer;
          }),
        },
      },
      createObjectUrl: (blob) => {
        const url = `blob:scadmill-${++objectSequence}`;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectUrl: revoked,
      importModule,
      createRuntime,
    },
  };
}

describe("verified OpenSCAD WASM loader", () => {
  it("pins both runtime hashes to the exact ENGINE_VERSION values and uses distinct versioned paths", () => {
    const engineVersion = readFileSync(new URL("../../ENGINE_VERSION", import.meta.url), "utf8");

    for (const [name, artifact] of Object.entries(OPENSCAD_WASM_ARTIFACTS)) {
      const field = name === "openscad.js"
        ? "wasm.source_build.openscad_js.sha256"
        : "wasm.source_build.openscad_wasm.sha256";
      const values = [...engineVersion.matchAll(new RegExp(`^${field.replaceAll(".", "\\.")}: (.+)$`, "gmu"))];
      expect(values).toHaveLength(1);
      expect(values[0]?.[1]).toBe(artifact.sha256);
      expect(artifact.bytes).toBe(name === "openscad.js" ? 100_027 : 10_760_714);
      expect(artifact.path).toContain("2026.06.12");
      expect(artifact.path).toMatch(new RegExp(`${name.replace(".", "\\.")}$`, "u"));
    }
    expect(OPENSCAD_WASM_ARTIFACTS["openscad.js"].path)
      .not.toBe(OPENSCAD_WASM_ARTIFACTS["openscad.wasm"].path);
  });

  it("fetches, reports progress, verifies both assets before execution, and passes an isolated WASM copy", async () => {
    const events: string[] = [];
    const progress: OpenScadWasmProgress[] = [];
    let digestedWasm: BufferSource | undefined;
    const setup = environment({
      onDigest: (asset, source) => {
        events.push(`digest:${asset}`);
        if (asset === "openscad.wasm") digestedWasm = source;
      },
      importModule: async (url) => {
        events.push("import");
        return { default: (await setup.blobs.get(url)?.arrayBuffer())?.byteLength };
      },
      createRuntime: async (namespace, options) => {
        events.push("runtime");
        expect(namespace).toEqual({ default: javascriptBytes.byteLength });
        expect(options.wasmBinary?.byteLength).toBe(wasmBytes.byteLength);
        expect(options.wasmBinary).not.toBe(digestedWasm);
        const digestedBytes = digestedWasm instanceof ArrayBuffer
          ? new Uint8Array(digestedWasm)
          : new Uint8Array(
              digestedWasm?.buffer ?? new ArrayBuffer(0),
              digestedWasm?.byteOffset ?? 0,
              digestedWasm?.byteLength ?? 0,
            );
        expect(Buffer.from(options.wasmBinary ?? []).equals(Buffer.from(digestedBytes)))
          .toBe(true);
        const wasmObjectUrl = options.locateFile("openscad.wasm");
        expect(wasmObjectUrl).toMatch(/^blob:scadmill-/u);
        expect(setup.blobs.get(wasmObjectUrl)).toMatchObject({
          size: wasmBytes.byteLength,
          type: "application/wasm",
        });
        expect(() => options.locateFile("unexpected.data")).toThrow(/unexpected engine asset/u);
        return runtime;
      },
    });

    const result = await loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines?ignored=yes#fragment",
      onProgress: (event) => progress.push(event),
    }, setup.value);

    expect(result).toBe(runtime);
    expect(setup.value.fetch).toHaveBeenCalledTimes(2);
    expect(setup.value.fetch).toHaveBeenNthCalledWith(
      1,
      "https://cdn.example/engines/2026.06.12/openscad.js",
      { cache: "force-cache" },
    );
    expect(setup.value.fetch).toHaveBeenNthCalledWith(
      2,
      "https://cdn.example/engines/2026.06.12/openscad.wasm",
      { cache: "force-cache" },
    );
    expect(events.slice(0, 2).sort()).toEqual(["digest:openscad.js", "digest:openscad.wasm"]);
    expect(vi.mocked(setup.value.crypto.subtle.digest).mock.calls.map(([algorithm]) => algorithm))
      .toEqual(["SHA-256", "SHA-256"]);
    expect(events.slice(2)).toEqual(["import", "runtime"]);
    expect(progress).toEqual(expect.arrayContaining([
      { asset: "openscad.js", loadedBytes: javascriptBytes.byteLength, totalBytes: javascriptBytes.byteLength },
      { asset: "openscad.wasm", loadedBytes: wasmBytes.byteLength, totalBytes: wasmBytes.byteLength },
    ]));
    expect((await [...setup.blobs.values()][0]?.arrayBuffer())?.byteLength)
      .toBe(javascriptBytes.byteLength);
    expect(setup.revoked).toHaveBeenCalledTimes(2);
    expect(setup.createRuntime).toHaveBeenCalledOnce();
  });

  it("does not execute JavaScript until both independent SHA-256 checks resolve", async () => {
    const setup = environment();
    const resolutions = new Map<number, (value: ArrayBuffer) => void>();
    vi.mocked(setup.value.crypto.subtle.digest).mockImplementation((_algorithm, data) => {
      const length = data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
      return new Promise((resolve) => resolutions.set(length, resolve));
    });

    const loading = loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, setup.value);
    await vi.waitFor(() => expect(resolutions.size).toBe(2));
    expect(setup.value.importModule).not.toHaveBeenCalled();
    resolutions.get(javascriptBytes.byteLength)?.(
      bytesFromHex(TEST_ARTIFACTS["openscad.js"].sha256).buffer,
    );
    await Promise.resolve();
    expect(setup.value.importModule).not.toHaveBeenCalled();
    resolutions.get(wasmBytes.byteLength)?.(
      bytesFromHex(TEST_ARTIFACTS["openscad.wasm"].sha256).buffer,
    );
    await expect(loading).resolves.toBe(runtime);
    expect(setup.value.importModule).toHaveBeenCalledOnce();
  });

  it("does not let a throwing progress observer interrupt a verified load", async () => {
    const setup = environment();
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
      onProgress: () => {
        throw new Error("observer failure");
      },
    }, setup.value)).resolves.toBe(runtime);
  });

  it("fails closed on an HTTP error without hashing, importing, or constructing a runtime", async () => {
    const setup = environment({
      fetch: vi.fn(async (url) => fixtureResponse(
        String(url).endsWith("openscad.js") ? javascriptBytes : wasmBytes,
        String(url).endsWith("openscad.js") ? 404 : 200,
      )),
    });

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, setup.value)).rejects.toThrow(/openscad\.js.+HTTP 404/iu);
    expect(setup.value.crypto.subtle.digest).not.toHaveBeenCalled();
    expect(setup.value.importModule).not.toHaveBeenCalled();
    expect(setup.createRuntime).not.toHaveBeenCalled();
  });

  it.each(["openscad.js", "openscad.wasm"] as const)(
    "refuses a %s hash mismatch before executing JavaScript",
    async (asset) => {
      const setup = environment({ badHashFor: asset });
      await expect(loadVerifiedOpenScadWasm({
        artifactBaseUrl: "https://cdn.example/engines/",
      }, setup.value)).rejects.toThrow(new RegExp(`${asset.replace(".", "\\.")}.*SHA-256`, "iu"));
      expect(setup.value.importModule).not.toHaveBeenCalled();
      expect(setup.createRuntime).not.toHaveBeenCalled();
      expect(setup.revoked).not.toHaveBeenCalled();
    },
  );

  it("fails closed when SHA-256 cannot be computed", async () => {
    const setup = environment();
    vi.mocked(setup.value.crypto.subtle.digest).mockRejectedValueOnce(new Error("crypto unavailable"));

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, setup.value)).rejects.toThrow(/crypto unavailable/u);
    expect(setup.value.importModule).not.toHaveBeenCalled();
    expect(setup.createRuntime).not.toHaveBeenCalled();
  });

  it("always revokes the verified JavaScript object URL when module execution fails", async () => {
    const setup = environment({ importModule: async () => { throw new Error("module rejected"); } });

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, setup.value)).rejects.toThrow(/module rejected/u);
    expect(setup.revoked).toHaveBeenCalledOnce();
    expect(setup.createRuntime).not.toHaveBeenCalled();
  });

  it("revokes both verified object URLs before propagating a runtime-construction failure", async () => {
    const setup = environment({
      createRuntime: async () => { throw new Error("invalid module namespace"); },
    });

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, setup.value)).rejects.toThrow(/invalid module namespace/u);
    expect(setup.revoked).toHaveBeenCalledTimes(2);
  });

  it("uses the pinned decoded length when a compressed transfer reports a different length", async () => {
    const progress: OpenScadWasmProgress[] = [];
    const setup = environment({
      fetch: vi.fn(async (url) => String(url).endsWith("openscad.js")
        ? new Response(javascriptBytes, { headers: { "content-length": "17" } })
        : fixtureResponse(wasmBytes)),
    });
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
      onProgress: (event) => progress.push(event),
    }, setup.value)).resolves.toBe(runtime);
    expect(progress).toContainEqual({
      asset: "openscad.js",
      loadedBytes: javascriptBytes.byteLength,
      totalBytes: javascriptBytes.byteLength,
    });
  });

  it("ignores inherited artifact manifests and retains the production trust anchor", async () => {
    const setup = environment();
    const inheritedEnvironment = Object.assign(
      Object.create({ artifacts: TEST_ARTIFACTS }) as OpenScadWasmLoaderEnvironment,
      setup.value,
    );
    Reflect.deleteProperty(inheritedEnvironment, "artifacts");

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, inheritedEnvironment)).rejects.toThrow(/openscad\.js.+expected 100027/iu);
    expect(setup.value.importModule).not.toHaveBeenCalled();
  });

  it("cancels a streamed asset as soon as it exceeds its exact pinned maximum", async () => {
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    let read = false;
    const oversized = new Uint8Array(javascriptBytes.byteLength + 1);
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => {
            if (read) return { done: true as const };
            read = true;
            return { done: false as const, value: oversized };
          },
          cancel,
          releaseLock,
        }),
      },
      arrayBuffer: async () => oversized.buffer,
    } as unknown as Response;
    const setup = environment({
      fetch: vi.fn(async (url) => String(url).endsWith("openscad.js")
        ? response
        : fixtureResponse(wasmBytes)),
    });

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, setup.value)).rejects.toThrow(/openscad\.js.+exceeded/iu);
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(setup.value.crypto.subtle.digest).not.toHaveBeenCalled();
  });

  it("rejects a streamed asset that ends below its exact pinned length", async () => {
    const truncated = javascriptBytes.slice(0, -1);
    const setup = environment({
      fetch: vi.fn(async (url) => String(url).endsWith("openscad.js")
        ? new Response(truncated)
        : fixtureResponse(wasmBytes)),
    });
    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
    }, setup.value)).rejects.toThrow(/openscad\.js.+length/iu);
    expect(setup.value.importModule).not.toHaveBeenCalled();
  });

  it("rejects a pre-aborted load before network access and remains fail closed", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch_ = vi.fn();
    const setup = environment({ fetch: fetch_ });

    await expect(loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
      signal: controller.signal,
    }, setup.value)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch_).not.toHaveBeenCalled();
    expect(setup.value.importModule).not.toHaveBeenCalled();
    expect(setup.createRuntime).not.toHaveBeenCalled();
  });

  it("passes a live caller abort signal to both asset fetches", async () => {
    const controller = new AbortController();
    const fetch_ = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return String(url).endsWith("openscad.js")
        ? fixtureResponse(javascriptBytes)
        : fixtureResponse(wasmBytes);
    });
    const setup = environment({ fetch: fetch_ });

    await loadVerifiedOpenScadWasm({
      artifactBaseUrl: "https://cdn.example/engines/",
      signal: controller.signal,
    }, setup.value);

    expect(fetch_).toHaveBeenCalledTimes(2);
  });

  it.each([
    "relative/path",
    "file:///tmp/engine/",
    "javascript:alert(1)",
  ])("rejects unsupported artifact base URL %s before network access", async (artifactBaseUrl) => {
    const setup = environment();
    await expect(loadVerifiedOpenScadWasm({ artifactBaseUrl }, setup.value))
      .rejects.toThrow(/absolute HTTP\(S\) URL/u);
    expect(setup.value.fetch).not.toHaveBeenCalled();
  });
});
