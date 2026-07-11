export interface SettingsPersistence {
  load(): string | null;
  save(serializedSettings: string): void | Promise<void>;
}

export const EPHEMERAL_SETTINGS_PERSISTENCE: SettingsPersistence = Object.freeze({
  load: () => null,
  save: () => undefined,
});
