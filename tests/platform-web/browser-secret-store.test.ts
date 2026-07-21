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
    expect(session.values.get("scadmill:ai-secret:session")).toBe("secret-session");
  });

  it("isolates two safe configuration scopes without changing the legacy default keys", async () => {
    const session = storage();
    const local = storage();
    const secrets = createBrowserSecretStore(session, local);

    await secrets.save("legacy", false);
    await secrets.save("alpha-secret", false, "provider-alpha");
    await secrets.save("beta-secret", true, "provider-beta");

    await expect(secrets.load(false)).resolves.toBe("legacy");
    await expect(secrets.load(false, "default")).resolves.toBe("legacy");
    await expect(secrets.load(false, "provider-alpha")).resolves.toBe("alpha-secret");
    await expect(secrets.load(true, "provider-beta")).resolves.toBe("beta-secret");
    await expect(secrets.load(false, "provider-beta")).resolves.toBe("");
    expect(session.values.get("scadmill:ai-secret:session")).toBe("legacy");
    expect(session.values.get("scadmill:ai-secret:session:provider-alpha")).toBe("alpha-secret");
    expect(local.values.get("scadmill:ai-secret:persisted:provider-beta")).toBe("beta-secret");

    await secrets.clear("provider-alpha");
    await expect(secrets.load(false, "provider-alpha")).resolves.toBe("");
    await expect(secrets.load(false)).resolves.toBe("legacy");
    await expect(secrets.load(true, "provider-beta")).resolves.toBe("beta-secret");
  });

  it.each(["", "bad/scope", "x".repeat(129)])(
    "rejects an invalid or oversized configuration scope before browser storage access: %j",
    async (scope) => {
      const session = storage();
      const local = storage();
      const secrets = createBrowserSecretStore(session, local);

      await expect(secrets.load(false, scope)).rejects.toThrow("scope");
      await expect(secrets.save("secret", false, scope)).rejects.toThrow("scope");
      await expect(secrets.clear(scope)).rejects.toThrow("scope");
      expect(session.values.size + local.values.size).toBe(0);
    },
  );

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

  it("retains the session key when the persisted destination write fails", async () => {
    const session = storage();
    const local = storage();
    const secrets = createBrowserSecretStore(session, local);
    await secrets.save("session-key", false);
    local.setItem = () => { throw new Error("local storage blocked"); };

    await expect(secrets.save("persisted-key", true)).rejects.toThrow("unavailable");
    await expect(secrets.load(false)).resolves.toBe("session-key");
    expect(local.values.size).toBe(0);
  });

  it("retains the persisted key when the session destination write fails", async () => {
    const session = storage();
    const local = storage();
    const secrets = createBrowserSecretStore(session, local);
    await secrets.save("persisted-key", true);
    session.setItem = () => { throw new Error("session storage blocked"); };

    await expect(secrets.save("session-key", false)).rejects.toThrow("unavailable");
    await expect(secrets.load(true)).resolves.toBe("persisted-key");
    expect(session.values.size).toBe(0);
  });

  it("retains both copies when deleting the persisted source fails during opt-out", async () => {
    const session = storage();
    const local = storage();
    const initial = createBrowserSecretStore(session, local);
    await initial.save("persisted-key", true);
    local.removeItem = () => { throw new Error("local storage blocked"); };
    const secrets = createBrowserSecretStore(session, local);

    await expect(secrets.save("session-key", false)).rejects.toThrow("unavailable");
    expect(session.values.size).toBe(1);
    expect(local.values.size).toBe(1);
  });

  it("retains both copies when deleting the session source fails during opt-in", async () => {
    const session = storage();
    const local = storage();
    const initial = createBrowserSecretStore(session, local);
    await initial.save("session-key", false);
    session.removeItem = () => { throw new Error("session storage blocked"); };
    const secrets = createBrowserSecretStore(session, local);

    await expect(secrets.save("persisted-key", true)).rejects.toThrow("unavailable");
    expect(session.values.size).toBe(1);
    expect(local.values.size).toBe(1);
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

      await expect(secrets.load(false)).rejects.toThrow("unavailable");
      await expect(secrets.save("sentinel", false)).rejects.toThrow("unavailable");
      await expect(secrets.clear()).rejects.toThrow("unavailable");
    } finally {
      if (sessionDescriptor) Object.defineProperty(globalThis, "sessionStorage", sessionDescriptor);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
      if (localDescriptor) Object.defineProperty(globalThis, "localStorage", localDescriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("reports a transient secret read failure instead of treating it as an empty key", async () => {
    const session = storage();
    session.getItem = () => { throw new Error("transient read failure"); };
    const secrets = createBrowserSecretStore(session, storage());

    await expect(secrets.load(false)).rejects.toThrow("unavailable");
  });

  it("enforces the shared limit in UTF-8 bytes", async () => {
    const secrets = createBrowserSecretStore(storage(), storage());

    await expect(secrets.save("😀".repeat(4_097), false)).rejects.toThrow("supported size");
  });
});
