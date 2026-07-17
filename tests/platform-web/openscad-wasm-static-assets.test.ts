import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { OPENSCAD_WASM_ARTIFACTS } from "../../src/platform-web/openscad-wasm-loader";

const STATIC_ENGINE_ROOT = resolve(process.cwd(), "public", "openscad-engine");
const MANIFEST = {
  path: "2026.06.12/manifest.json",
  bytes: 599,
  sha256: "ab195992b8316002d07d7630ae33ce276eb86a06be320be9f1604ca81a8787c4",
} as const;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("static OpenSCAD WebAssembly artifacts", () => {
  it.each(Object.entries(OPENSCAD_WASM_ARTIFACTS))(
    "stages the exact verified %s bytes at the worker URL",
    async (_name, artifact) => {
      const bytes = await readFile(resolve(STATIC_ENGINE_ROOT, artifact.path));

      expect(bytes).toHaveLength(artifact.bytes);
      expect(sha256(bytes)).toBe(artifact.sha256.toLowerCase());
    },
  );

  it("stages the source-build manifest beside the versioned assets", async () => {
    const bytes = await readFile(resolve(STATIC_ENGINE_ROOT, MANIFEST.path));
    const manifest = JSON.parse(bytes.toString("utf8")) as unknown;

    expect(bytes).toHaveLength(MANIFEST.bytes);
    expect(sha256(bytes)).toBe(MANIFEST.sha256);
    expect(manifest).toMatchObject({
      source_commit: "0a66508c67374febcfc814a73b5b948dd84a1ca3",
      openscad_version: "2026.06.12",
      emcc_version: "4.0.10",
      cmake_flags:
        "-DCMAKE_BUILD_TYPE=Release -DEXPERIMENTAL=ON -DSNAPSHOT=ON -DOPENSCAD_VERSION=2026.06.12",
      artifacts: {
        "openscad.js": {
          sha256: OPENSCAD_WASM_ARTIFACTS["openscad.js"].sha256.toLowerCase(),
        },
        "openscad.wasm": {
          sha256: OPENSCAD_WASM_ARTIFACTS["openscad.wasm"].sha256.toLowerCase(),
        },
      },
    });
  });
});
