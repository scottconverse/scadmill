export type SettingsLoadResult =
  | { readonly kind: "missing" }
  | { readonly kind: "loaded"; readonly serializedSettings: string }
  | { readonly kind: "error" };

export interface SettingsPersistence {
  load(): SettingsLoadResult;
  save(serializedSettings: string): void | Promise<void>;
}

export const EPHEMERAL_SETTINGS_PERSISTENCE: SettingsPersistence = Object.freeze({
  load: () => ({ kind: "missing" as const }),
  save: () => undefined,
});
