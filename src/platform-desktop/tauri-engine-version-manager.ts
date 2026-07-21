import { invoke } from "@tauri-apps/api/core";

import type {
  EngineVersionManagerPort,
  InstalledEngineVersion,
  OfficialEngineRelease,
} from "../application/engine/engine-version-manager";
import type { Invoke } from "./tauri-bridge";

function decode(value: unknown): readonly InstalledEngineVersion[] {
  if (!Array.isArray(value) || value.length > 128) throw new Error("The installed-engine list is invalid.");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("The installed-engine list is invalid.");
    }
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).length !== 4
      || typeof item.version !== "string" || item.version.length === 0 || item.version.length > 64
      || typeof item.executablePath !== "string" || item.executablePath.length === 0 || item.executablePath.length > 32_768
      || typeof item.sha256 !== "string" || !/^[A-F0-9]{64}$/u.test(item.sha256)
      || !["managed", "configured", "discovered", "bundled"].includes(item.source as string)
      || seen.has(item.executablePath)) throw new Error("The installed-engine list is invalid.");
    seen.add(item.executablePath);
    return item as unknown as InstalledEngineVersion;
  });
}

function decodeOfficial(value: unknown): readonly OfficialEngineRelease[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("The official-engine list is invalid.");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("The official-engine list is invalid.");
    }
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).length !== 4
      || typeof item.id !== "string" || !/^[A-Za-z0-9._-]{1,96}$/u.test(item.id)
      || typeof item.version !== "string" || item.version.length === 0 || item.version.length > 64
      || typeof item.platform !== "string" || item.platform.length === 0 || item.platform.length > 64
      || typeof item.archiveSha256 !== "string" || !/^[A-F0-9]{64}$/u.test(item.archiveSha256)
      || seen.has(item.id)) throw new Error("The official-engine list is invalid.");
    seen.add(item.id);
    return item as unknown as OfficialEngineRelease;
  });
}

function decodeInstalled(value: unknown): InstalledEngineVersion {
  const installed = decode([value]);
  const first = installed[0];
  if (!first) throw new Error("The installed-engine response is invalid.");
  return first;
}

export function createTauriEngineVersionManager(
  configuredEnginePath: () => string,
  invokeCommand: Invoke = invoke,
): EngineVersionManagerPort {
  return {
    async listInstalled() {
      const configured = configuredEnginePath().trim();
      return decode(await invokeCommand("engine_manager_list", configured
        ? { configuredEnginePath: configured }
        : undefined));
    },
    async listOfficial() {
      return decodeOfficial(await invokeCommand("engine_manager_official_releases"));
    },
    async installOfficial(releaseId) {
      if (!/^[A-Za-z0-9._-]{1,96}$/u.test(releaseId)) throw new Error("The official engine release id is invalid.");
      return decodeInstalled(await invokeCommand("engine_manager_install_official", { releaseId }));
    },
  };
}
