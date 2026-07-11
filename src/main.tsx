import { isTauri } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { NativeEngineService } from "./application/engine/native-engine-service";
import { UnavailableEngineService } from "./application/engine/unavailable-engine-service";
import { createTauriBridge } from "./platform-desktop/tauri-bridge";
import { createEnginePathConfiguration } from "./platform-desktop/engine-path-configuration";
import { createTauriSecretStore } from "./platform-desktop/tauri-secret-store";
import { createTauriSettingsPersistence } from "./platform-desktop/tauri-settings-persistence";
import { createTauriProjectStorage } from "./platform-desktop/tauri-project-storage";
import { createTauriArtifactDestination } from "./platform-desktop/tauri-artifact-destination";
import {
  createDesktopRecentProjectsPersistence,
  createDesktopRecoveryPersistence,
  createDesktopScratchAutosavePersistence,
} from "./platform-desktop/desktop-project-metadata";
import { createBrowserLayoutPersistence } from "./platform-web/browser-layout-persistence";
import { createBrowserSecretStore } from "./platform-web/browser-secret-store";
import { createBrowserSettingsPersistence } from "./platform-web/browser-settings-persistence";
import { createAvailableBrowserProjectStorage } from "./platform-web/indexeddb-project-storage";
import { isMobileWebClient } from "./platform-web/mobile-web";
import { createBrowserArtifactDestination } from "./platform-web/browser-artifact-destination";
import {
  createBrowserRecentProjectsPersistence,
  createBrowserRecoveryPersistence,
  createBrowserScratchAutosavePersistence,
} from "./platform-web/browser-project-metadata";

const desktop = isTauri();
const enginePathConfiguration = desktop ? createEnginePathConfiguration() : undefined;
const engine = desktop
  ? new NativeEngineService(
      createTauriBridge(undefined, undefined, () => enginePathConfiguration?.load() ?? null),
      () => globalThis.crypto.randomUUID(),
    )
  : new UnavailableEngineService();
const layoutPersistence = desktop ? undefined : createBrowserLayoutPersistence();
const settingsPersistence = desktop
  ? await createTauriSettingsPersistence()
  : createBrowserSettingsPersistence();
const secretStore = desktop ? createTauriSecretStore() : createBrowserSecretStore();
const browserProjectStorage = desktop ? undefined : createAvailableBrowserProjectStorage();
const projectStorage = desktop ? createTauriProjectStorage() : browserProjectStorage;
const mobileWeb = !desktop && isMobileWebClient();
const artifactDestination = desktop
  ? createTauriArtifactDestination()
  : createBrowserArtifactDestination();
const recoveryPersistence = desktop
  ? createDesktopRecoveryPersistence()
  : createBrowserRecoveryPersistence();
const recentProjectsPersistence = desktop
  ? createDesktopRecentProjectsPersistence()
  : createBrowserRecentProjectsPersistence();
const scratchAutosavePersistence = desktop
  ? createDesktopScratchAutosavePersistence()
  : createBrowserScratchAutosavePersistence();

const root = document.getElementById("root");
if (!root) {
  throw new Error("ScadMill could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <App
      artifactDestination={artifactDestination}
      canRevealProjectFiles={desktop}
      engine={engine}
      forceNarrowLayout={mobileWeb}
      layoutPersistence={layoutPersistence}
      projectStorage={projectStorage}
      projectPortabilityStorage={browserProjectStorage}
      recentProjectsPersistence={recentProjectsPersistence}
      recoveryPersistence={recoveryPersistence}
      scratchAutosavePersistence={scratchAutosavePersistence}
      settingsPersistence={settingsPersistence}
      secretStore={secretStore}
      enginePathConfiguration={enginePathConfiguration}
    />
  </StrictMode>,
);
