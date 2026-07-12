import { describe, expect, it, vi } from "vitest";
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
    expect(persistence.load()).toEqual({
      kind: "loaded",
      serializedSettings: "settings-json",
    });
  });

  it("distinguishes unreadable storage from a missing settings record", () => {
    const persistence = createBrowserSettingsPersistence({
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("full"); },
    });
    expect(persistence.load()).toEqual({ kind: "error" });
    expect(() => persistence.save("settings-json")).toThrow("not loaded safely");
  });

  it("retains a transient read failure and refuses to overwrite unknown durable bytes", () => {
    let reads = 0;
    const setItem = vi.fn();
    const persistence = createBrowserSettingsPersistence({
      getItem: () => {
        reads += 1;
        if (reads === 1) throw new Error("temporarily blocked");
        return "existing-durable-settings";
      },
      setItem,
    });

    expect(persistence.load()).toEqual({ kind: "error" });
    expect(persistence.load()).toEqual({ kind: "error" });
    expect(() => persistence.save("replacement-settings")).toThrow("not loaded safely");
    expect(reads).toBe(1);
    expect(setItem).not.toHaveBeenCalled();
  });
});
