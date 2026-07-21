import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("OpenSCAD web-engine compliance package", () => {
  it("binds the distributed bytes to exact recursive source, license, recipe, and checksums", async () => {
    const [workflow, notice] = await Promise.all([
      readFile(join(process.cwd(), ".github", "workflows", "package-openscad-web-engine.yml"), "utf8"),
      readFile(join(process.cwd(), "engine-compliance", "openscad-2026.06.12", "README.md"), "utf8"),
    ]);

    for (const exact of [
      "0a66508c67374febcfc814a73b5b948dd84a1ca3",
      `openscad-wasm-\${{ env.OPENSCAD_COMMIT }}`,
      `run-id: \${{ env.SOURCE_BUILD_RUN }}`,
      "git clone --no-checkout --recurse-submodules https://github.com/openscad/openscad.git",
      "submodule update --init --recursive",
      "submodule status --recursive",
      "--sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner --exclude-vcs",
      "cp \"$RUNNER_TEMP/openscad/COPYING\" \"$payload/COPYING\"",
      "cp .github/workflows/build-openscad-wasm.yml \"$payload/build-openscad-wasm.yml\"",
      "sha256sum COPYING ENGINE_VERSION README.md build-openscad-wasm.yml manifest.json openscad.js openscad.wasm",
      "if-no-files-found: error",
    ]) expect(workflow).toContain(exact);
    expect(workflow).not.toContain("continue-on-error");

    for (const exact of [
      "100,027 bytes",
      "10,760,714 bytes",
      "E458673D46D506D77B780C526D6E5492250F353D582057C6F912724A9586D86E",
      "F908AAFA32FEBE9A3A20F76ACA6B8101051BF2FC7655F094F18C6D99B52683EA",
      "exact official checkout and recursive submodule contents",
      "Publication is a separate release action",
    ]) expect(notice).toContain(exact);
  });
});
