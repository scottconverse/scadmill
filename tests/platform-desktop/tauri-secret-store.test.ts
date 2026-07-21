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

  it("isolates configuration scopes and preserves exact legacy default command arguments", async () => {
    const values = new Map<string, string>();
    const mockedInvoke = vi.fn(<T>(command: string, args?: Record<string, unknown>) => {
      const profileId = String(args?.profileId ?? "default");
      if (command === "load_ai_secret") return Promise.resolve((values.get(profileId) ?? "") as T);
      if (command === "save_ai_secret") values.set(profileId, String(args?.secret ?? ""));
      if (command === "clear_ai_secret") values.delete(profileId);
      return Promise.resolve(undefined as T);
    });
    const secrets = createTauriSecretStore(mockedInvoke as TauriInvoke);

    await secrets.save("legacy", false);
    await secrets.save("alpha-secret", false, "provider-alpha");
    await secrets.save("beta-secret", true, "provider-beta");
    await expect(secrets.load(false)).resolves.toBe("legacy");
    await expect(secrets.load(false, "default")).resolves.toBe("legacy");
    await expect(secrets.load(false, "provider-alpha")).resolves.toBe("alpha-secret");
    await expect(secrets.load(true, "provider-beta")).resolves.toBe("beta-secret");
    await secrets.clear("provider-alpha");
    await expect(secrets.load(false, "provider-alpha")).resolves.toBe("");
    await expect(secrets.load(false)).resolves.toBe("legacy");

    expect(mockedInvoke.mock.calls).toContainEqual(["save_ai_secret", { secret: "legacy" }]);
    expect(mockedInvoke.mock.calls).toContainEqual(["save_ai_secret", { secret: "alpha-secret", profileId: "provider-alpha" }]);
    expect(mockedInvoke.mock.calls).toContainEqual(["load_ai_secret", { profileId: "provider-beta" }]);
    expect(mockedInvoke.mock.calls).toContainEqual(["clear_ai_secret", { profileId: "provider-alpha" }]);
  });

  it.each(["", "bad/scope", "x".repeat(129)])(
    "rejects an invalid or oversized configuration scope before desktop IPC: %j",
    async (scope) => {
      const invoke = vi.fn() as unknown as TauriInvoke;
      const secrets = createTauriSecretStore(invoke);

      await expect(secrets.load(false, scope)).rejects.toThrow("scope");
      await expect(secrets.save("secret", false, scope)).rejects.toThrow("scope");
      await expect(secrets.clear(scope)).rejects.toThrow("scope");
      expect(invoke).not.toHaveBeenCalled();
    },
  );

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
