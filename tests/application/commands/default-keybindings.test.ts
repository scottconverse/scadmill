import { describe, expect, it } from "vitest";

import {
  createKeybindingSettings,
  DEFAULT_KEYBINDINGS,
  matchesKeybinding,
} from "../../../src/application/commands/default-keybindings";

describe("Appendix D default keybindings", () => {
  it("defines every normative command and alternate binding", () => {
    expect(DEFAULT_KEYBINDINGS).toEqual({
      saveDocument: "Mod+S",
      saveAllDocuments: "Mod+Alt+S",
      newFile: "Mod+N",
      openProject: "Mod+O",
      closeTab: "Mod+W",
      reopenClosedTab: "Mod+Shift+T",
      nextTab: "Ctrl+Tab",
      previousTab: "Ctrl+Shift+Tab",
      find: "Mod+F",
      replace: "Mod+H",
      findInProject: "Mod+Shift+F",
      goToLine: "Mod+G",
      goToDefinition: "F12",
      toggleComment: "Mod+/",
      formatDocument: "Shift+Alt+F",
      undo: "Mod+Z",
      redo: "Mod+Y",
      redoAlternate: "Mod+Shift+Z",
      multiCursorAdd: "Alt+Click",
      renderPreview: "F5",
      renderFull: "F6",
      cancelRender: "Escape",
      exportModel: "Mod+E",
      zoomViewerToFit: "Mod+0",
      axisFront: "Numpad1",
      axisRight: "Numpad3",
      axisTop: "Numpad7",
      togglePerspective: "Numpad5",
      screenshotViewport: "Mod+Shift+P",
      toggleConsole: "Mod+J",
      toggleDock: "Mod+B",
      toggleParameters: "Mod+Shift+B",
      maximizeEditor: "Mod+Shift+E",
      maximizeViewer: "Mod+Shift+V",
      settings: "Mod+,",
      commandPalette: "Mod+Shift+K",
      switchCodeModel: "Mod+M",
    });
  });

  it("creates typed runtime overrides and matches exact modifier scopes", () => {
    const configured = createKeybindingSettings({ renderPreview: "Mod+R" });
    expect(configured.renderPreview).toBe("Mod+R");
    expect(configured.renderFull).toBe("F6");
    expect(Object.isFrozen(configured)).toBe(true);

    const event = {
      key: "R",
      code: "KeyR",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    };
    expect(matchesKeybinding(event, "Mod+R", "control")).toBe(true);
    expect(matchesKeybinding({ ...event, shiftKey: true }, "Mod+R", "control")).toBe(false);
    expect(matchesKeybinding({ ...event, ctrlKey: false }, "Mod+R", "control")).toBe(false);
    expect(matchesKeybinding({
      ...event,
      code: "Numpad1",
      key: "End",
      ctrlKey: false,
    }, "Numpad1", "control")).toBe(true);
  });

  it("resolves Mod against one explicit platform primary modifier", () => {
    const controlEvent = {
      key: "r",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      altKey: false,
    };
    const metaEvent = {
      ...controlEvent,
      ctrlKey: false,
      metaKey: true,
    };

    expect(matchesKeybinding(controlEvent, "Mod+R", "control")).toBe(true);
    expect(matchesKeybinding(controlEvent, "Mod+R", "meta")).toBe(false);
    expect(matchesKeybinding(metaEvent, "Mod+R", "meta")).toBe(true);
    expect(matchesKeybinding(metaEvent, "Mod+R", "control")).toBe(false);
  });

  it("refuses collisions inside one focus scope while allowing the same key across scopes", () => {
    expect(() => createKeybindingSettings({ find: "Mod+H" })).toThrow(
      "Keybinding collision: replace conflicts with find",
    );
    expect(() => createKeybindingSettings({ cancelRender: "F5" })).not.toThrow();
  });

  it("canonicalizes modifier order before checking same-scope collisions", () => {
    expect(() => createKeybindingSettings({
      renderPreview: "Shift+Mod+R",
      renderFull: "Mod+Shift+R",
    })).toThrow("Keybinding collision: renderFull conflicts with renderPreview");
  });
});
