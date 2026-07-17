import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  isPlatformMenuCommand,
  type PlatformCommandSource,
  type PlatformMenuCommand,
  type PlatformMenuState,
} from "../application/platform/scadmill-platform";

export const NATIVE_MENU_COMMAND_EVENT = "scadmill://menu-command";

export async function disableTauriNativeMenu(): Promise<void> {
  await invoke("disable_native_menu");
}

export async function createTauriMenuCommandSource(): Promise<PlatformCommandSource> {
  const subscribers = new Set<(command: PlatformMenuCommand) => void>();
  await listen<unknown>(NATIVE_MENU_COMMAND_EVENT, (event) => {
    if (!isPlatformMenuCommand(event.payload)) return;
    for (const subscriber of subscribers) subscriber(event.payload);
  });
  return Object.freeze({
    subscribe(listener: (command: PlatformMenuCommand) => void) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async synchronize(state: PlatformMenuState) {
      const items = Object.entries(state).map(([id, item]) => ({ id, ...item }));
      await invoke("update_native_menu_state", { items });
    },
  });
}
