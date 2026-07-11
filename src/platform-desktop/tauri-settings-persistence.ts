import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { SettingsPersistence } from "../application/settings/settings-persistence";

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function createTauriSettingsPersistence(
  invoke: TauriInvoke = tauriInvoke,
): Promise<SettingsPersistence> {
  let cached = await invoke<string | null>("load_settings").catch(() => null);
  let writes = Promise.resolve();
  return {
    load: () => cached,
    save(serializedSettings) {
      writes = writes
        .catch(() => undefined)
        .then(() => invoke<void>("save_settings", { serializedSettings }))
        .then(() => { cached = serializedSettings; });
      return writes;
    },
  };
}
