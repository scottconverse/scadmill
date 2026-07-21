import { describe, expect, it, vi } from "vitest";

import { createTauriEngineVersionManager } from "../../src/platform-desktop/tauri-engine-version-manager";
import type { Invoke } from "../../src/platform-desktop/tauri-bridge";

describe("createTauriEngineVersionManager", () => {
  it("strictly decodes installed engines and includes the configured path", async () => {
    const response = [{
      version: "X", executablePath: "C:/Engines/X/openscad.exe",
      sha256: "A".repeat(64), source: "managed",
    }];
    const invoke = vi.fn(async () => response) as unknown as Invoke;
    const manager = createTauriEngineVersionManager(() => " C:/Default/openscad.exe ", invoke);

    await expect(manager.listInstalled()).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledWith("engine_manager_list", {
      configuredEnginePath: "C:/Default/openscad.exe",
    });
  });

  it("lists official downloads and installs only the selected allow-listed release", async () => {
    const release = {
      id: "windows-2026.06.12-x86_64", version: "2026.06.12",
      platform: "Windows x86-64", archiveSha256: "A".repeat(64),
    };
    const installed = {
      version: "2026.06.12", executablePath: "C:/managed/openscad.exe",
      sha256: "D".repeat(64), source: "managed",
    };
    const invoke = vi.fn(async (command: string) => command === "engine_manager_official_releases"
      ? [release]
      : installed) as unknown as Invoke;
    const manager = createTauriEngineVersionManager(() => "", invoke);

    await expect(manager.listOfficial()).resolves.toEqual([release]);
    await expect(manager.installOfficial(release.id)).resolves.toEqual(installed);
    expect(invoke).toHaveBeenLastCalledWith("engine_manager_install_official", { releaseId: release.id });
  });

  it("rejects malformed or duplicate native records", async () => {
    const response = [
      { version: "X", executablePath: "same", sha256: "A".repeat(64), source: "managed" },
      { version: "Y", executablePath: "same", sha256: "B".repeat(64), source: "managed" },
    ];
    const invoke = vi.fn(async () => response) as unknown as Invoke;
    await expect(createTauriEngineVersionManager(() => "", invoke).listInstalled())
      .rejects.toThrow(/invalid/i);
  });
});
