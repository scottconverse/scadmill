import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Windows installer contract", () => {
  it("produces an offline NSIS installer whose app has no dynamic Visual C++ runtime dependency", async () => {
    const root = process.cwd();
    const [tauriConfigSource, cargoConfig] = await Promise.all([
      readFile(
        join(root, "src", "desktop-shell", "src-tauri", "tauri.conf.json"),
        "utf8",
      ),
      readFile(join(root, ".cargo", "config.toml"), "utf8").catch(() => ""),
    ]);
    const tauriConfig = JSON.parse(tauriConfigSource) as {
      bundle?: {
        active?: boolean;
        targets?: string[];
        windows?: {
          nsis?: { installMode?: string };
          webviewInstallMode?: { type?: string };
        };
      };
    };

    expect(tauriConfig.bundle).toMatchObject({
      active: true,
      targets: ["nsis"],
      windows: {
        nsis: { installMode: "currentUser" },
        webviewInstallMode: { type: "offlineInstaller" },
      },
    });
    expect(cargoConfig).toContain(
      '[target.\'cfg(all(windows, target_env = "msvc"))\']',
    );
    expect(cargoConfig).toContain(
      'rustflags = ["-C", "target-feature=+crt-static"]',
    );
  });
});
