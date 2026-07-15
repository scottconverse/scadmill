import type { WelcomePreferencePersistence } from "../application/welcome/welcome-preference";
import { messages } from "../messages/en";

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const WELCOME_PREFERENCE_KEY = "scadmill.welcome.v1";

function availableStorage(storage?: KeyValueStorage): KeyValueStorage | null {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function decodePreference(serialized: string | null): boolean {
  if (serialized === null) return true;
  try {
    const value: unknown = JSON.parse(serialized);
    return typeof value === "object"
      && value !== null
      && !Array.isArray(value)
      && Object.keys(value).sort().join(",") === "showOnLaunch,version"
      && (value as Record<string, unknown>).version === 1
      && typeof (value as Record<string, unknown>).showOnLaunch === "boolean"
      ? (value as { showOnLaunch: boolean }).showOnLaunch
      : true;
  } catch {
    return true;
  }
}

export function createBrowserWelcomePreferencePersistence(
  storage?: KeyValueStorage,
): WelcomePreferencePersistence {
  const selected = availableStorage(storage);
  return {
    load: () => {
      try { return decodePreference(selected?.getItem(WELCOME_PREFERENCE_KEY) ?? null); }
      catch { return true; }
    },
    save: (showOnLaunch) => {
      try {
        if (!selected) throw new Error("unavailable");
        selected.setItem(WELCOME_PREFERENCE_KEY, JSON.stringify({ version: 1, showOnLaunch }));
      } catch {
        throw new Error(messages.welcomePreferenceCouldNotBeSaved);
      }
    },
  };
}
