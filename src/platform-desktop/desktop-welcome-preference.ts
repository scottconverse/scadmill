import type { WelcomePreferencePersistence } from "../application/welcome/welcome-preference";
import { createBrowserWelcomePreferencePersistence } from "../platform-web/browser-welcome-preference";

interface DurableWebviewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createDesktopWelcomePreferencePersistence(
  storage?: DurableWebviewStorage,
): WelcomePreferencePersistence {
  return createBrowserWelcomePreferencePersistence(storage);
}
