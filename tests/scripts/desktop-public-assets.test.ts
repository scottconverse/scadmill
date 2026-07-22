import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { emittedAssetFileName, publicDirectoryForMode } from "../../vite.config";

describe("desktop public-asset isolation", () => {
  it("copies the separate engine artifacts only into web builds", async () => {
    const root = process.cwd();
    const [packageSource, tauriSource] = await Promise.all([
      readFile(join(root, "package.json"), "utf8"),
      readFile(
        join(root, "src", "desktop-shell", "src-tauri", "tauri.conf.json"),
        "utf8",
      ),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      scripts?: Record<string, string>;
    };
    const tauriConfig = JSON.parse(tauriSource) as {
      build?: { beforeBuildCommand?: string };
      bundle?: { icon?: string[] };
    };

    expect(publicDirectoryForMode("desktop")).toBe(false);
    expect(publicDirectoryForMode("production")).toBe("public");
    expect(packageJson.scripts?.["build:desktop"])
      .toBe("tsc --noEmit && vite build --mode desktop");
    expect(tauriConfig.build?.beforeBuildCommand).toBe("pnpm --dir ../.. build:desktop");
    expect(tauriConfig.bundle?.icon).toContain("icons/128x128.png");
  });

  it("emits the pinned Kiri:Moto manifold runtime at its required local URL", () => {
    expect(emittedAssetFileName(["manifold.wasm"])).toBe("wasm/manifold.wasm");
    expect(emittedAssetFileName(["engine.js"])).toBe("assets/[name]-[hash][extname]");
  });
});
