import type { SettingsPersistence } from "../application/settings/settings-persistence";

export const BROWSER_SETTINGS_STORAGE_KEY = "scadmill:settings:v1";

export interface BrowserSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): BrowserSettingsStorage | undefined {
  return globalThis.localStorage;
}

export function createBrowserSettingsPersistence(
  storage?: BrowserSettingsStorage,
  storageProvider: () => BrowserSettingsStorage | undefined = browserStorage,
): SettingsPersistence {
  let resolved = storage;
  let attempted = storage !== undefined;
  const getStorage = () => {
    if (attempted) return resolved;
    attempted = true;
    try {
      resolved = storageProvider();
    } catch {
      resolved = undefined;
    }
    return resolved;
  };
  return {
    load() {
      try {
        return getStorage()?.getItem(BROWSER_SETTINGS_STORAGE_KEY) ?? null;
      } catch {
        return null;
      }
    },
    save(serializedSettings) {
      try {
        const target = getStorage();
        if (!target) throw new Error("Browser storage is unavailable.");
        target.setItem(BROWSER_SETTINGS_STORAGE_KEY, serializedSettings);
      } catch (error) {
        throw new Error("Browser settings could not be saved.", { cause: error });
      }
    },
  };
}
