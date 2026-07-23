import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const cargoManifest = readFileSync("src/desktop-shell/src-tauri/Cargo.toml", "utf8");
const cargoLock = readFileSync("src/desktop-shell/src-tauri/Cargo.lock", "utf8");
const rustShell = readFileSync("src/desktop-shell/src-tauri/src/lib.rs", "utf8");
const tauriConfig = JSON.parse(
  readFileSync("src/desktop-shell/src-tauri/tauri.conf.json", "utf8"),
) as {
  identifier: string;
  app: { windows: Array<{ minWidth?: number; minHeight?: number }> };
};
const packagedEvidence = readFileSync("scripts/run-packaged-desktop-evidence.mjs", "utf8");

describe("desktop window-state contract", () => {
  it("pins and registers the official persistence plugin without displacing single-instance startup", () => {
    expect(cargoManifest).toContain('tauri-plugin-window-state = "=2.4.1"');
    expect(cargoLock).toMatch(
      /name = "tauri-plugin-window-state"\r?\nversion = "2\.4\.1"/u,
    );

    const singleInstance = rustShell.indexOf("tauri_plugin_single_instance::init");
    const windowState = rustShell.indexOf(
      "tauri_plugin_window_state::Builder::default().build()",
    );
    const build = rustShell.indexOf(".build(tauri::generate_context!())");
    expect(singleInstance).toBeGreaterThan(-1);
    expect(windowState).toBeGreaterThan(singleInstance);
    expect(build).toBeGreaterThan(windowState);
    expect(rustShell).toContain(
      "use tauri_plugin_window_state::{AppHandleExt as _, StateFlags};",
    );
    expect(rustShell).toContain("tauri::RunEvent::ExitRequested { .. }");
    expect(rustShell).toContain("app.save_window_state(StateFlags::all())");
  });

  it("uses a macOS-safe application identifier consistently for packaged WebView evidence", () => {
    expect(tauriConfig.identifier).toBe("dev.scadmill.desktop");
    expect(tauriConfig.identifier.endsWith(".app")).toBe(false);
    expect(packagedEvidence).toContain('join(process.env.LOCALAPPDATA, "dev.scadmill.desktop")');
    expect(packagedEvidence).not.toContain('join(process.env.LOCALAPPDATA, "dev.scadmill.app")');
  });

  it("retains the minimum usable desktop window size", () => {
    expect(tauriConfig.app.windows[0]).toMatchObject({ minWidth: 800, minHeight: 600 });
  });
});
