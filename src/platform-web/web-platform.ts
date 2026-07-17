import { UnavailableEngineService } from "../application/engine/unavailable-engine-service";
import { available, type ScadMillPlatform, unavailable } from "../application/platform/scadmill-platform";
import { createBrowserArtifactDestination } from "./browser-artifact-destination";
import { createBrowserLayoutPersistence } from "./browser-layout-persistence";
import {
  createBrowserRecentProjectsPersistence,
  createBrowserRecoveryPersistence,
  createBrowserScratchAutosavePersistence,
  createBrowserWorkspaceMetadataPersistence,
} from "./browser-project-metadata";
import { createBrowserSecretStore } from "./browser-secret-store";
import { createBrowserSettingsPersistence } from "./browser-settings-persistence";
import { createBrowserWasmEngine } from "./browser-wasm-engine";
import { createBrowserWelcomePreferencePersistence } from "./browser-welcome-preference";
import { createAvailableBrowserProjectStorage } from "./indexeddb-project-storage";
import { isMobileWebClient } from "./mobile-web";
import { EPHEMERAL_RENDER_DISK_CACHE_PREFERENCES } from "../application/render-cache/render-cache-preference";

export function createWebPlatform(): ScadMillPlatform {
  const wasm = createBrowserWasmEngine();
  const projectStorage = createAvailableBrowserProjectStorage();
  const noDirectoryPicker = unavailable<never>();
  return {
    kind: "web",
    engine: wasm.engine ?? new UnavailableEngineService(),
    files: {
      projectStorage,
      portabilityStorage: projectStorage,
      workspaceDirectory: projectStorage,
      directoryPicker: noDirectoryPicker,
      revealInOs: unavailable(),
      trashInOs: unavailable(),
      fileAssociations: unavailable(),
      slicerHandoff: unavailable(),
    },
    dialogs: {
      openDirectory: noDirectoryPicker,
      saveFile: unavailable(),
      message: available({
        async show(message) { globalThis.alert(message); },
      }),
    },
    menus: { presentation: "web", commands: unavailable() },
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
      makeProjectId: () => `web-import-${globalThis.crypto.randomUUID()}`,
    },
    persistence: {
      layout: createBrowserLayoutPersistence(),
      settings: createBrowserSettingsPersistence(),
      secrets: createBrowserSecretStore(),
      recovery: createBrowserRecoveryPersistence(),
      recentProjects: createBrowserRecentProjectsPersistence(),
      scratchAutosave: createBrowserScratchAutosavePersistence(),
      workspaceMetadata: createBrowserWorkspaceMetadataPersistence(),
      welcome: createBrowserWelcomePreferencePersistence(),
      renderCache: unavailable(),
      renderCachePreferences: EPHEMERAL_RENDER_DISK_CACHE_PREFERENCES,
    },
    artifacts: createBrowserArtifactDestination(),
    enginePathConfiguration: unavailable(),
    wasm: available({ progress: wasm.progress, clearProgress: wasm.clearProgress }),
    mcp: unavailable(),
    windowControls: unavailable(),
    engineVersionManager: unavailable(),
    forceNarrowLayout: isMobileWebClient(),
  };
}
