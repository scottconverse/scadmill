// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const { currentWindow, dialogMessage, dialogOpen, dialogSave, invoke, listen } = vi.hoisted(() => ({
  currentWindow: {
    close: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
  },
  invoke: vi.fn(),
  listen: vi.fn(),
  dialogMessage: vi.fn(),
  dialogOpen: vi.fn(),
  dialogSave: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => currentWindow }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: dialogMessage,
  open: dialogOpen,
  save: dialogSave,
}));

import { createDesktopPlatform } from "../../src/platform-desktop/desktop-platform";

describe("desktop platform composition", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
    listen.mockResolvedValue(vi.fn());
    dialogOpen.mockResolvedValue("C:\\models");
    dialogSave.mockResolvedValue("C:\\exports\\part.stl");
    dialogMessage.mockResolvedValue(undefined);
    invoke.mockImplementation((command: string) => {
      if (command === "load_settings") return Promise.resolve(null);
      return Promise.resolve(undefined);
    });
  });

  it("declares the complete desktop dialog and window-control platform capabilities", async () => {
    const platform = await createDesktopPlatform();

    expect(platform.kind).toBe("desktop");
    expect(platform.files.directoryPicker.available).toBe(true);
    expect(platform.files.revealInOs.available).toBe(true);
    expect(platform.files.trashInOs.available).toBe(true);
    expect(platform.files.fileAssociations.available).toBe(true);
    expect(platform.files.slicerHandoff.available).toBe(true);
    expect(platform.menus.presentation).toBe("native");
    expect(platform.menus.commands.available).toBe(true);
    expect(platform.dialogs.openDirectory.available).toBe(true);
    expect(platform.dialogs.saveFile.available).toBe(true);
    expect(platform.dialogs.message.available).toBe(true);
    expect(platform.mcp.available).toBe(true);
    expect(platform.windowControls.available).toBe(true);
    expect(platform.engineVersionManager.available).toBe(true);

    if (!platform.dialogs.openDirectory.available || !platform.dialogs.saveFile.available
      || !platform.dialogs.message.available || !platform.windowControls.available) {
      throw new Error("Expected the desktop platform contract to be available.");
    }
    await expect(platform.dialogs.openDirectory.service.chooseDirectory()).resolves.toEqual({
      projectId: "C:\\models",
      displayName: "models",
    });
    await expect(platform.dialogs.saveFile.service.choosePath({
      title: "Export",
      suggestedName: "part.stl",
      extensions: ["stl"],
    })).resolves.toBe("C:\\exports\\part.stl");
    await platform.dialogs.message.service.show("Saved", { kind: "info" });
    await platform.windowControls.service.minimize();
    await platform.windowControls.service.toggleMaximize();
    await platform.windowControls.service.close();
    expect(currentWindow.minimize).toHaveBeenCalledOnce();
    expect(currentWindow.toggleMaximize).toHaveBeenCalledOnce();
    expect(currentWindow.close).toHaveBeenCalledOnce();
  });

  it("adapts validated Tauri menu events into the typed platform command source", async () => {
    const platform = await createDesktopPlatform();
    expect(listen).toHaveBeenCalledWith("scadmill://menu-command", expect.any(Function));
    if (!platform.menus.commands.available) throw new Error("Native menu commands are unavailable.");
    const listener = vi.fn();
    const unsubscribe = platform.menus.commands.service.subscribe(listener);
    const tauriListener = listen.mock.calls[0]?.[1] as ((event: { payload: unknown }) => void);

    tauriListener({ payload: "render.preview" });
    tauriListener({ payload: "not-a-command" });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith("render.preview");

    unsubscribe();
    tauriListener({ payload: "render.full" });
    expect(listener).toHaveBeenCalledOnce();

    await platform.menus.commands.service.synchronize({
      "render.preview": { enabled: false, accelerator: "F5" },
      "view.toggle-console": { enabled: true, checked: true, accelerator: "CmdOrCtrl+J" },
    });
    expect(invoke).toHaveBeenCalledWith("update_native_menu_state", {
      items: [
        { id: "render.preview", enabled: false, accelerator: "F5" },
        { id: "view.toggle-console", enabled: true, checked: true, accelerator: "CmdOrCtrl+J" },
      ],
    });
  });

  it("keeps the desktop editor available when optional event bridges fail to subscribe", async () => {
    listen.mockRejectedValue(new Error("event bridge unavailable"));

    await expect(createDesktopPlatform()).resolves.toMatchObject({
      kind: "desktop",
      files: { fileAssociations: { available: false } },
      menus: { presentation: "web", commands: { available: false } },
    });
    expect(invoke).toHaveBeenCalledWith("disable_native_menu");
  });
});
