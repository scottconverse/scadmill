import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  SettingsLoadResult,
  SettingsPersistence,
} from "../application/settings/settings-persistence";

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function createTauriSettingsPersistence(
  invoke: TauriInvoke = tauriInvoke,
): Promise<SettingsPersistence> {
  let cached: SettingsLoadResult;
  try {
    const serializedSettings = await invoke<string | null>("load_settings");
    cached = serializedSettings === null
      ? { kind: "missing" }
      : { kind: "loaded", serializedSettings };
  } catch {
    cached = { kind: "error" };
  }
  let writes = Promise.resolve();
  return {
    load: () => cached,
    save(serializedSettings) {
      if (cached.kind === "error") {
        return Promise.reject(
          new Error("Desktop settings were not loaded safely; existing settings were not changed."),
        );
      }
      writes = writes
        .catch(() => undefined)
        .then(() => invoke<void>("save_settings", { serializedSettings }))
        .then(() => { cached = { kind: "loaded", serializedSettings }; });
      return writes;
    },
  };
}
