import { NativeEngineService } from "../application/engine/native-engine-service";
import { available, type ScadMillPlatform, unavailable } from "../application/platform/scadmill-platform";
import {
  createDesktopRecentProjectsPersistence,
  createDesktopRecoveryPersistence,
  createDesktopRenderDiskCachePreferencePersistence,
  createDesktopScratchAutosavePersistence,
  createDesktopWorkspaceLayoutPersistence,
  createDesktopWorkspaceMetadataPersistence,
} from "./desktop-project-metadata";
import { createDesktopRenderThumbnailPersistence } from "./desktop-thumbnail-persistence";
import { createDesktopModelHistoryPersistence } from "./model-history-persistence";
import { createDesktopWelcomePreferencePersistence } from "./desktop-welcome-preference";
import { createEnginePathConfiguration } from "./engine-path-configuration";
import { createTauriArtifactDestination } from "./tauri-artifact-destination";
import { createTauriAssociatedFileSource } from "./tauri-associated-file-source";
import { createTauriAiFetchFactory } from "./tauri-ai-http-fetch";
import { createTauriBridge } from "./tauri-bridge";
import { createTauriMessageDialog, createTauriSaveFileDialog } from "./tauri-dialogs";
import {
  createTauriMenuCommandSource,
  disableTauriNativeMenu,
} from "./tauri-menu-command-source";
import { createTauriMcpPort } from "./tauri-mcp-port";
import { createTauriProjectDirectoryPicker } from "./tauri-project-directory-picker";
import { createTauriProjectStorage } from "./tauri-project-storage";
import { createTauriRenderCacheStorage } from "./tauri-render-cache";
import { createTauriSecretStore } from "./tauri-secret-store";
import { createTauriSettingsPersistence } from "./tauri-settings-persistence";
import { createTauriWindowControls } from "./tauri-window-controls";

export async function createDesktopPlatform(): Promise<ScadMillPlatform> {
  const enginePathConfiguration = createEnginePathConfiguration();
  const directoryPicker = createTauriProjectDirectoryPicker();
  const [menuCommands, associatedFiles] = await Promise.allSettled([
    createTauriMenuCommandSource(),
    createTauriAssociatedFileSource(),
  ]);
  if (menuCommands.status === "rejected") await disableTauriNativeMenu();
  return {
    kind: "desktop",
    aiFetch: createTauriAiFetchFactory(),
    engine: new NativeEngineService(
      createTauriBridge(undefined, undefined, () => enginePathConfiguration.load()),
      () => globalThis.crypto.randomUUID(),
    ),
    files: {
      projectStorage: createTauriProjectStorage(),
      directoryPicker: available(directoryPicker),
      revealInOs: available(true),
      trashInOs: available(true),
      fileAssociations: associatedFiles.status === "fulfilled"
        ? available(associatedFiles.value)
        : unavailable(),
      slicerHandoff: unavailable(),
    },
    dialogs: {
      openDirectory: available(directoryPicker),
      saveFile: available(createTauriSaveFileDialog()),
      message: available(createTauriMessageDialog()),
    },
    menus: {
      presentation: menuCommands.status === "fulfilled" ? "native" : "web",
      commands: menuCommands.status === "fulfilled" ? available(menuCommands.value) : unavailable(),
    },
    clipboard: {
      async writeText(value) {
        if (!globalThis.navigator?.clipboard?.writeText) {
          throw new Error("Clipboard access is unavailable.");
        }
        await globalThis.navigator.clipboard.writeText(value);
      },
    },
    location: {
      currentHref: () => globalThis.location.href,
      makeProjectId: () => `desktop-import-${globalThis.crypto.randomUUID()}`,
    },
    persistence: {
      layout: createDesktopWorkspaceLayoutPersistence(),
      settings: await createTauriSettingsPersistence(),
      secrets: createTauriSecretStore(),
      recovery: createDesktopRecoveryPersistence(),
      recentProjects: createDesktopRecentProjectsPersistence(),
      scratchAutosave: createDesktopScratchAutosavePersistence(),
      workspaceMetadata: createDesktopWorkspaceMetadataPersistence(),
      welcome: createDesktopWelcomePreferencePersistence(),
      renderCache: available(createTauriRenderCacheStorage()),
      renderCachePreferences: createDesktopRenderDiskCachePreferencePersistence(),
      renderThumbnails: createDesktopRenderThumbnailPersistence(),
      modelHistory: createDesktopModelHistoryPersistence(),
    },
    artifacts: createTauriArtifactDestination(),
    enginePathConfiguration: available(enginePathConfiguration),
    wasm: unavailable(),
    mcp: available(createTauriMcpPort()),
    windowControls: available(createTauriWindowControls()),
    engineVersionManager: unavailable(),
    forceNarrowLayout: false,
  };
}
