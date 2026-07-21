import {
  assertSupportedSecretSize,
  normalizeSecretScope,
  type SecretStore,
} from "../application/settings/secret-store";

const SESSION_KEY = "scadmill:ai-secret:session";
const PERSISTED_KEY = "scadmill:ai-secret:persisted";

function storageKey(base: string, scope?: string): string {
  const normalized = normalizeSecretScope(scope);
  return normalized ? `${base}:${normalized}` : base;
}

export interface SecretStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const UNAVAILABLE_STORAGE: SecretStorage = Object.freeze({
  getItem: () => { throw new Error("Browser storage is unavailable."); },
  setItem: () => { throw new Error("Browser storage is unavailable."); },
  removeItem: () => { throw new Error("Browser storage is unavailable."); },
});

function browserStorage(name: "sessionStorage" | "localStorage"): SecretStorage {
  try {
    return globalThis[name] ?? UNAVAILABLE_STORAGE;
  } catch {
    return UNAVAILABLE_STORAGE;
  }
}

export function createBrowserSecretStore(
  session?: SecretStorage,
  local?: SecretStorage,
): SecretStore {
  const sessionStorage = session ?? browserStorage("sessionStorage");
  const localStorage = local ?? browserStorage("localStorage");
  return {
    persistence: "web-session",
    async load(persist, scope) {
      const key = storageKey(persist ? PERSISTED_KEY : SESSION_KEY, scope);
      try {
        return (persist ? localStorage : sessionStorage).getItem(key) ?? "";
      } catch {
        throw new Error("AI secret storage is unavailable.");
      }
    },
    async save(secret, persist, scope) {
      assertSupportedSecretSize(secret);
      const sessionKey = storageKey(SESSION_KEY, scope);
      const persistedKey = storageKey(PERSISTED_KEY, scope);
      try {
        if (persist) {
          localStorage.setItem(persistedKey, secret);
          sessionStorage.removeItem(sessionKey);
        } else {
          sessionStorage.setItem(sessionKey, secret);
          localStorage.removeItem(persistedKey);
        }
      } catch {
        throw new Error("AI secret storage is unavailable.");
      }
    },
    async clear(scope) {
      const sessionKey = storageKey(SESSION_KEY, scope);
      const persistedKey = storageKey(PERSISTED_KEY, scope);
      let unavailable = false;
      try {
        sessionStorage.removeItem(sessionKey);
      } catch {
        unavailable = true;
      }
      try {
        localStorage.removeItem(persistedKey);
      } catch {
        unavailable = true;
      }
      if (unavailable) throw new Error("AI secret storage is unavailable.");
    },
  };
}
