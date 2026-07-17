import { describe, expect, it } from "vitest";

import { createBrowserWelcomePreferencePersistence } from "../../src/platform-web/browser-welcome-preference";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("browser welcome preference", () => {
  it("defaults on for a fresh profile and round-trips one strict versioned preference", () => {
    const storage = new MemoryStorage();
    const preference = createBrowserWelcomePreferencePersistence(storage);

    expect(preference.load()).toBe(true);
    preference.save(false);

    expect(storage.values.get("scadmill.welcome.v1")).toBe(
      '{"version":1,"showOnLaunch":false}',
    );
    expect(createBrowserWelcomePreferencePersistence(storage).load()).toBe(false);
  });

  it("fails open on malformed reads and reports blocked writes", () => {
    const malformed = new MemoryStorage();
    malformed.setItem("scadmill.welcome.v1", '{"version":1,"showOnLaunch":"no"}');
    expect(createBrowserWelcomePreferencePersistence(malformed).load()).toBe(true);

    const blocked = createBrowserWelcomePreferencePersistence({
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
    });
    expect(blocked.load()).toBe(true);
    expect(() => blocked.save(false)).toThrow(/welcome preference could not be saved/iu);
  });
});
