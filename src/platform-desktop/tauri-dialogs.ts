import { message, save } from "@tauri-apps/plugin-dialog";

import type {
  MessageDialogPort,
  SaveFileDialogPort,
} from "../application/platform/scadmill-platform";

export function createTauriSaveFileDialog(): SaveFileDialogPort {
  const dialog: SaveFileDialogPort = {
    async choosePath(options) {
      const selected = await save({
        title: options.title,
        defaultPath: options.suggestedName,
        filters: options.extensions?.length
          ? [{ name: "Files", extensions: [...options.extensions] }]
          : undefined,
      });
      return typeof selected === "string" ? selected : null;
    },
  };
  return Object.freeze(dialog);
}

export function createTauriMessageDialog(): MessageDialogPort {
  const dialog: MessageDialogPort = {
    async show(text, options) {
      await message(text, {
        title: options?.title,
        kind: options?.kind ?? "info",
      });
    },
  };
  return Object.freeze(dialog);
}
