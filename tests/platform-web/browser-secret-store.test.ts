import { describe, expect, it } from "vitest";
import { createBrowserSecretStore } from "../../src/platform-web/browser-secret-store";

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("browser AI secret storage", () => {
  it("uses session storage by default and does not write local storage", async () => {
    const session = storage();
    const local = storage();
    const secrets = createBrowserSecretStore(session, local);
    await secrets.save("secret-session", false);

    await expect(secrets.load(false)).resolves.toBe("secret-session");
    expect(local.values.size).toBe(0);
    expect(session.values.size).toBe(1);
  });

  it("moves the key to local storage only after explicit persisted opt-in", async () => {
    const session = storage();
    const local = storage();
    const secrets = createBrowserSecretStore(session, local);
    await secrets.save("secret-persisted", true);

    await expect(secrets.load(true)).resolves.toBe("secret-persisted");
    expect(session.values.size).toBe(0);
    expect(local.values.size).toBe(1);
    await secrets.clear();
    expect(session.values.size + local.values.size).toBe(0);
  });

  it("drops the default key with the browser session but retains an opted-in key", async () => {
    const local = storage();
    const firstSession = createBrowserSecretStore(storage(), local);
    await firstSession.save("session-only", false);

    const restarted = createBrowserSecretStore(storage(), local);
    await expect(restarted.load(false)).resolves.toBe("");
    await restarted.save("persisted-by-choice", true);

    const laterSession = createBrowserSecretStore(storage(), local);
    await expect(laterSession.load(true)).resolves.toBe("persisted-by-choice");
  });

  it("does not create a session copy when deleting the persisted key fails during opt-out", async () => {
    const session = storage();
    const local = storage();
    const initial = createBrowserSecretStore(session, local);
    await initial.save("persisted-key", true);
    local.removeItem = () => { throw new Error("local storage blocked"); };
    const secrets = createBrowserSecretStore(session, local);

    await expect(secrets.save("session-key", false)).rejects.toThrow("unavailable");
    expect(session.values.size).toBe(0);
    expect(local.values.size).toBe(1);
  });

  it("does not create a persisted copy when deleting the session key fails during opt-in", async () => {
    const session = storage();
    const local = storage();
    session.removeItem = () => { throw new Error("session storage blocked"); };
    const secrets = createBrowserSecretStore(session, local);

    await expect(secrets.save("persisted-key", true)).rejects.toThrow("unavailable");
    expect(local.values.size).toBe(0);
  });

  it("attempts both removals and reports a partial clear instead of claiming success", async () => {
    const session = storage();
    const local = storage();
    const secrets = createBrowserSecretStore(session, local);
    await secrets.save("persisted-key", true);
    session.removeItem = () => { throw new Error("session storage blocked"); };

    await expect(secrets.clear()).rejects.toThrow("unavailable");
    expect(local.values.size).toBe(0);
  });

  it("constructs an unavailable store when browser storage getters are blocked", async () => {
    const sessionDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const localDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    try {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        get: () => { throw new DOMException("blocked", "SecurityError"); },
      });
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        get: () => { throw new DOMException("blocked", "SecurityError"); },
      });

      const secrets = createBrowserSecretStore();

      await expect(secrets.load(false)).resolves.toBe("");
      await expect(secrets.save("sentinel", false)).rejects.toThrow("unavailable");
      await expect(secrets.clear()).rejects.toThrow("unavailable");
    } finally {
      if (sessionDescriptor) Object.defineProperty(globalThis, "sessionStorage", sessionDescriptor);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
      if (localDescriptor) Object.defineProperty(globalThis, "localStorage", localDescriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("enforces the shared limit in UTF-8 bytes", async () => {
    const secrets = createBrowserSecretStore(storage(), storage());

    await expect(secrets.save("😀".repeat(4_097), false)).rejects.toThrow("supported size");
  });
});
