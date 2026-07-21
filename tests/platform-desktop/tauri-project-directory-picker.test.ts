import { describe, expect, it, vi } from "vitest";

describe("Tauri project directory picker", () => {
  it("maps a selected native folder to a typed project location", async () => {
    const loading = import("../../src/platform-desktop/tauri-project-directory-picker");
    await expect(loading).resolves.toHaveProperty("createTauriProjectDirectoryPicker");
    const { createTauriProjectDirectoryPicker } = await loading;
    const openDirectory = vi.fn().mockResolvedValue("C:\\Models\\Gear\\");

    await expect(createTauriProjectDirectoryPicker(openDirectory).chooseDirectory()).resolves
      .toEqual({ projectId: "C:\\Models\\Gear", displayName: "Gear" });
    expect(openDirectory).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Choose an OpenSCAD project folder",
    });
  });

  it("preserves cancel and rejects malformed multi-selection results", async () => {
    const { createTauriProjectDirectoryPicker } = await import(
      "../../src/platform-desktop/tauri-project-directory-picker"
    );

    await expect(createTauriProjectDirectoryPicker(async () => null).chooseDirectory())
      .resolves.toBeNull();
    await expect(createTauriProjectDirectoryPicker(
      async () => ["C:\\Models\\One", "C:\\Models\\Two"],
    ).chooseDirectory()).rejects.toThrow(/single folder/u);
  });
});
