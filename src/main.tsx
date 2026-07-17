import { isTauri } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { createDesktopPlatform } from "./platform-desktop/desktop-platform";
import { createWebPlatform } from "./platform-web/web-platform";

const platform = isTauri() ? await createDesktopPlatform() : createWebPlatform();
const root = document.getElementById("root");
if (!root) throw new Error("ScadMill could not find its application root.");

createRoot(root).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
