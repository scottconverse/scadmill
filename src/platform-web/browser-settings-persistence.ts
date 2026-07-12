import type {
  SettingsLoadResult,
  SettingsPersistence,
} from "../application/settings/settings-persistence";

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
  let loadResult: SettingsLoadResult | undefined;
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
  const load = (): SettingsLoadResult => {
    if (loadResult) return loadResult;
    try {
      const target = getStorage();
      if (!target) {
        loadResult = { kind: "error" };
        return loadResult;
      }
      const serializedSettings = target.getItem(BROWSER_SETTINGS_STORAGE_KEY);
      loadResult = serializedSettings === null
        ? { kind: "missing" }
        : { kind: "loaded", serializedSettings };
    } catch {
      loadResult = { kind: "error" };
    }
    return loadResult;
  };
  return {
    load,
    save(serializedSettings) {
      if (load().kind === "error") {
        throw new Error("Browser settings were not loaded safely; existing settings were not changed.");
      }
      try {
        const target = getStorage();
        if (!target) throw new Error("Browser storage is unavailable.");
        target.setItem(BROWSER_SETTINGS_STORAGE_KEY, serializedSettings);
        loadResult = { kind: "loaded", serializedSettings };
      } catch (error) {
        throw new Error("Browser settings could not be saved.", { cause: error });
      }
    },
  };
}
