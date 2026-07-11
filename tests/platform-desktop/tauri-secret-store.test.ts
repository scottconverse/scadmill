import { describe, expect, it, vi } from "vitest";
import {
  createDefaultPersistedSettings,
  serializePersistedSettings,
} from "../../src/application/settings/settings-codec";
import { createTauriSecretStore } from "../../src/platform-desktop/tauri-secret-store";
import {
  createTauriSettingsPersistence,
  type TauriInvoke,
} from "../../src/platform-desktop/tauri-settings-persistence";

describe("desktop AI secret store", () => {
  it("uses only the keychain commands and never a file-backed settings command", async () => {
    const mockedInvoke = vi.fn(<T>(command: string) => Promise.resolve(
      (command === "load_ai_secret" ? "desktop-key" : undefined) as T,
    ));
    const invoke = mockedInvoke as TauriInvoke;
    const secrets = createTauriSecretStore(invoke);

    await expect(secrets.load(false)).resolves.toBe("desktop-key");
    await secrets.save("replacement-key", true);
    await secrets.clear();

    expect(mockedInvoke.mock.calls).toEqual([
      ["load_ai_secret"],
      ["save_ai_secret", { secret: "replacement-key" }],
      ["clear_ai_secret"],
    ]);
    expect(mockedInvoke.mock.calls.flat().join(" ")).not.toContain("settings");
  });

  it("rejects oversized keys before crossing the desktop IPC boundary", async () => {
    const invoke = vi.fn() as unknown as TauriInvoke;
    const secrets = createTauriSecretStore(invoke);

    await expect(secrets.save("x".repeat(16_385), false)).rejects.toThrow("supported size");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("measures the client-side key limit in UTF-8 bytes like the Rust boundary", async () => {
    const invoke = vi.fn() as unknown as TauriInvoke;
    const secrets = createTauriSecretStore(invoke);

    await expect(secrets.save("😀".repeat(4_097), false)).rejects.toThrow("supported size");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps a sentinel key out of every settings-file payload and only in keychain IPC", async () => {
    const writtenFiles: string[] = [];
    let keychain = "";
    const invoke = vi.fn(<T>(command: string, args?: Record<string, unknown>) => {
      if (command === "load_settings") return Promise.resolve(null as T);
      if (command === "save_settings") writtenFiles.push(String(args?.serializedSettings));
      if (command === "save_ai_secret") keychain = String(args?.secret);
      return Promise.resolve(undefined as T);
    }) as TauriInvoke;
    const settings = await createTauriSettingsPersistence(invoke);
    const secrets = createTauriSecretStore(invoke);
    const sentinel = "AC-9.c-SENTINEL-KEY";

    await settings.save(serializePersistedSettings(createDefaultPersistedSettings()));
    await secrets.save(sentinel, false);

    expect(writtenFiles).toHaveLength(1);
    expect(writtenFiles.join("\n")).not.toContain(sentinel);
    expect(keychain).toBe(sentinel);
  });
});
