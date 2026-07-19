export interface SecretStore {
  readonly persistence: "web-session" | "os-keychain";
  load(persist: boolean, scope?: string): Promise<string>;
  save(secret: string, persist: boolean, scope?: string): Promise<void>;
  clear(scope?: string): Promise<void>;
}

export const AI_SECRET_SIZE_LIMIT_BYTES = 16_384;
export const AI_SECRET_SCOPE_LIMIT = 128;
export const DEFAULT_AI_SECRET_SCOPE = "default";

export function normalizeSecretScope(scope?: string): string | undefined {
  if (scope === undefined || scope === DEFAULT_AI_SECRET_SCOPE) return undefined;
  if (scope.length === 0
    || scope.length > AI_SECRET_SCOPE_LIMIT
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(scope)) {
    throw new Error("AI secret scope is invalid.");
  }
  return scope;
}

export function assertSupportedSecretSize(secret: string): void {
  if (new TextEncoder().encode(secret).byteLength > AI_SECRET_SIZE_LIMIT_BYTES) {
    throw new Error("AI secret exceeds the supported size.");
  }
}

export const EPHEMERAL_SECRET_STORE: SecretStore = Object.freeze({
  persistence: "web-session",
  load: async () => "",
  save: async () => undefined,
  clear: async () => undefined,
});
