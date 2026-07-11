export interface SecretStore {
  readonly persistence: "web-session" | "os-keychain";
  load(persist: boolean): Promise<string>;
  save(secret: string, persist: boolean): Promise<void>;
  clear(): Promise<void>;
}

export const AI_SECRET_SIZE_LIMIT_BYTES = 16_384;

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
