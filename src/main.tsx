import { isTauri } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { NativeEngineService } from "./application/engine/native-engine-service";
import { UnavailableEngineService } from "./application/engine/unavailable-engine-service";
import { createTauriBridge } from "./platform-desktop/tauri-bridge";
import { createBrowserLayoutPersistence } from "./platform-web/browser-layout-persistence";
import { isMobileWebClient } from "./platform-web/mobile-web";

const desktop = isTauri();
const engine = desktop
  ? new NativeEngineService(createTauriBridge(), () => globalThis.crypto.randomUUID())
  : new UnavailableEngineService();
const layoutPersistence = desktop ? undefined : createBrowserLayoutPersistence();
const mobileWeb = !desktop && isMobileWebClient();

const root = document.getElementById("root");
if (!root) {
  throw new Error("ScadMill could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <App
      engine={engine}
      forceNarrowLayout={mobileWeb}
      layoutPersistence={layoutPersistence}
    />
  </StrictMode>,
);
