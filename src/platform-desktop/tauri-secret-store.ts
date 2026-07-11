import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  assertSupportedSecretSize,
  type SecretStore,
} from "../application/settings/secret-store";
import type { TauriInvoke } from "./tauri-settings-persistence";

export function createTauriSecretStore(invoke: TauriInvoke = tauriInvoke): SecretStore {
  return {
    persistence: "os-keychain",
    load: () => invoke<string>("load_ai_secret"),
    async save(secret) {
      assertSupportedSecretSize(secret);
      await invoke<void>("save_ai_secret", { secret });
    },
    clear: () => invoke<void>("clear_ai_secret"),
  };
}
