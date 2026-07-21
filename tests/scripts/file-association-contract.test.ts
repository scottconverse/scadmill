import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop associated-file contract", () => {
  it("registers .scad and wires every launch lifecycle into the pending queue", () => {
    const config = JSON.parse(
      readFileSync("src/desktop-shell/src-tauri/tauri.conf.json", "utf8"),
    ) as { bundle: { fileAssociations?: Array<{ ext: string[] }> } };
    expect(config.bundle.fileAssociations).toEqual([
      expect.objectContaining({ ext: ["scad"] }),
    ]);

    const cargo = readFileSync("src/desktop-shell/src-tauri/Cargo.toml", "utf8");
    expect(cargo).toContain('tauri-plugin-single-instance = "=2.4.3"');
    const runtime = readFileSync("src/desktop-shell/src-tauri/src/lib.rs", "utf8");
    expect(runtime).toContain("tauri_plugin_single_instance::init");
    expect(runtime).toContain("std::env::args_os().skip(1)");
    expect(runtime).toContain("tauri::RunEvent::Opened { urls }");
    expect(runtime).toContain("associated_files::take_pending_associated_files");
  });
});
