import {
  assertSupportedSecretSize,
  type SecretStore,
} from "../application/settings/secret-store";

const SESSION_KEY = "scadmill:ai-secret:session";
const PERSISTED_KEY = "scadmill:ai-secret:persisted";

export interface SecretStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const UNAVAILABLE_STORAGE: SecretStorage = Object.freeze({
  getItem: () => null,
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
    async load(persist) {
      try {
        return (persist ? localStorage : sessionStorage)
          .getItem(persist ? PERSISTED_KEY : SESSION_KEY) ?? "";
      } catch {
        return "";
      }
    },
    async save(secret, persist) {
      assertSupportedSecretSize(secret);
      try {
        if (persist) {
          sessionStorage.removeItem(SESSION_KEY);
          localStorage.setItem(PERSISTED_KEY, secret);
        } else {
          localStorage.removeItem(PERSISTED_KEY);
          sessionStorage.setItem(SESSION_KEY, secret);
        }
      } catch {
        throw new Error("AI secret storage is unavailable.");
      }
    },
    async clear() {
      let unavailable = false;
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        unavailable = true;
      }
      try {
        localStorage.removeItem(PERSISTED_KEY);
      } catch {
        unavailable = true;
      }
      if (unavailable) throw new Error("AI secret storage is unavailable.");
    },
  };
}
