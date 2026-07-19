import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  assertSupportedSecretSize,
  normalizeSecretScope,
  type SecretStore,
} from "../application/settings/secret-store";
import type { TauriInvoke } from "./tauri-settings-persistence";

export function createTauriSecretStore(invoke: TauriInvoke = tauriInvoke): SecretStore {
  const scopeArguments = (scope?: string): Record<string, string> | undefined => {
    const profileId = normalizeSecretScope(scope);
    return profileId ? { profileId } : undefined;
  };
  return {
    persistence: "os-keychain",
    async load(_persist, scope) {
      const args = scopeArguments(scope);
      return args ? invoke<string>("load_ai_secret", args) : invoke<string>("load_ai_secret");
    },
    async save(secret, _persist, scope) {
      assertSupportedSecretSize(secret);
      const args = scopeArguments(scope);
      await invoke<void>("save_ai_secret", args ? { secret, ...args } : { secret });
    },
    async clear(scope) {
      const args = scopeArguments(scope);
      await (args ? invoke<void>("clear_ai_secret", args) : invoke<void>("clear_ai_secret"));
    },
  };
}
