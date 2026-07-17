import { getCurrentWindow } from "@tauri-apps/api/window";

import type { WindowControlsPort } from "../application/platform/scadmill-platform";

export function createTauriWindowControls(): WindowControlsPort {
  const window = getCurrentWindow();
  return Object.freeze({
    close: () => window.close(),
    minimize: () => window.minimize(),
    toggleMaximize: () => window.toggleMaximize(),
  });
}
