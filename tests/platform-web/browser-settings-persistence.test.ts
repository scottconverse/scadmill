import { describe, expect, it } from "vitest";
import {
  BROWSER_SETTINGS_STORAGE_KEY,
  createBrowserSettingsPersistence,
} from "../../src/platform-web/browser-settings-persistence";

describe("browser settings persistence", () => {
  it("round-trips through the dedicated per-user local-storage key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const persistence = createBrowserSettingsPersistence(storage);
    persistence.save("settings-json");

    expect(values.get(BROWSER_SETTINGS_STORAGE_KEY)).toBe("settings-json");
    expect(persistence.load()).toBe("settings-json");
  });

  it("falls back on unreadable storage but reports a failed durable write", () => {
    const persistence = createBrowserSettingsPersistence({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
    });
    expect(persistence.load()).toBeNull();
    expect(() => persistence.save("settings-json")).toThrow("could not be saved");
  });
});
