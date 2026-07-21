import { describe, expect, it } from "vitest";

import {
  createSettingsState,
  type EditorSettings,
} from "../../../src/application/runtime/render-settings";
import { DEFAULT_KEYBINDINGS } from "../../../src/application/commands/default-keybindings";

describe("editor settings defaults", () => {
  it("preserves the current editor behavior as typed shared-state defaults", () => {
    const settings = createSettingsState();
    const editor: EditorSettings = settings.editor;

    expect(editor).toEqual({
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 14,
      tabWidth: 4,
      wordWrap: false,
      lineNumbers: true,
      minimap: false,
    });
    expect(settings.keybindings).toEqual(DEFAULT_KEYBINDINGS);
  });

  it("accepts injected keybinding overrides without changing the normative defaults", () => {
    const settings = createSettingsState({}, { find: "Alt+F", renderPreview: "Mod+R" });

    expect(settings.keybindings.find).toBe("Alt+F");
    expect(settings.keybindings.renderPreview).toBe("Mod+R");
    expect(settings.keybindings.renderFull).toBe("F6");
    expect(DEFAULT_KEYBINDINGS.find).toBe("Mod+F");
  });
});
