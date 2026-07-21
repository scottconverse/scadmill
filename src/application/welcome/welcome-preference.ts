export interface WelcomePreferencePersistence {
  load(): boolean;
  save(showOnLaunch: boolean): void;
}

export const HIDDEN_WELCOME_PREFERENCE: WelcomePreferencePersistence = Object.freeze({
  load: () => false,
  save: () => undefined,
});
