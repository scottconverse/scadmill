import { open } from "@tauri-apps/plugin-dialog";

import type { ProjectDirectoryPicker } from "../application/files/workspace-directory";
import { messages } from "../messages/en";

interface DirectoryDialogOptions {
  readonly directory: true;
  readonly multiple: false;
  readonly title: string;
}

export type OpenDirectoryDialog = (
  options: DirectoryDialogOptions,
) => Promise<string | readonly string[] | null>;

function trimTrailingSeparators(path: string): string {
  let value = path.trim();
  while (
    value.length > 1
    && /[\\/]$/u.test(value)
    && !/^[A-Za-z]:[\\/]$/u.test(value)
  ) value = value.slice(0, -1);
  return value;
}

function directoryName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

const openDirectory: OpenDirectoryDialog = (options) => open(options);

export function createTauriProjectDirectoryPicker(
  showOpenDialog: OpenDirectoryDialog = openDirectory,
): ProjectDirectoryPicker {
  return {
    chooseDirectory: async () => {
      const selected = await showOpenDialog({
        directory: true,
        multiple: false,
        title: messages.chooseProjectFolderTitle,
      });
      if (selected === null) return null;
      if (typeof selected !== "string") {
        throw new Error("The project chooser must return a single folder.");
      }
      const projectId = trimTrailingSeparators(selected);
      if (!projectId) throw new Error("The project chooser returned an empty folder path.");
      return { projectId, displayName: directoryName(projectId) };
    },
  };
}
