import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PLATFORM_MENU_COMMANDS } from "../../src/application/platform/scadmill-platform";

describe("native desktop menu contract", () => {
  it("builds all five required native menus and emits every typed command identifier", () => {
    const source = readFileSync("src/desktop-shell/src-tauri/src/native_menu.rs", "utf8");
    for (const heading of ["File", "Edit", "View", "Render", "Help"]) {
      expect(source).toContain(`SubmenuBuilder::new(app, "${heading}")`);
    }
    for (const command of PLATFORM_MENU_COMMANDS) {
      expect(source).toMatch(new RegExp(`\\.(?:text|check)\\("${command.replaceAll(".", "\\.")}",`, "u"));
    }
    expect(source).toContain("update_native_menu_state");
    expect(source).toContain(".set_enabled(");
    expect(source).toContain(".set_checked(");
    expect(source).toContain(".set_accelerator(");
    for (const role of [".cut()", ".copy()", ".paste()", ".select_all()", ".quit()"]) {
      expect(source).toContain(role);
    }
    expect(source).toContain('app.emit("scadmill://menu-command", event.id().as_ref())');
  });
});
