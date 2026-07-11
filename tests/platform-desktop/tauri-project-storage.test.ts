import { describe, expect, it, vi } from "vitest";

import { createTauriProjectStorage } from "../../src/platform-desktop/tauri-project-storage";

describe("Tauri project storage", () => {
  it("loads a complete text-and-binary project snapshot", async () => {
    const invoke = vi.fn().mockResolvedValue([
      { path: "main.scad", text: true, contentsBase64: "Y3ViZSgxKTs=" },
      { path: "assets/reference.stl", text: false, contentsBase64: "AP8B" },
    ]);

    const snapshot = await createTauriProjectStorage(invoke).snapshot("C:\\Models\\Gear");

    expect(invoke).toHaveBeenCalledWith("project_snapshot", {
      projectId: "C:\\Models\\Gear",
    });
    expect(snapshot.projectId).toBe("C:\\Models\\Gear");
    expect(snapshot.files.get("main.scad" as never)).toBe("cube(1);");
    expect(snapshot.files.get("assets/reference.stl" as never)).toEqual(
      new Uint8Array([0, 255, 1]),
    );
  });

  it("reads only one requested file for external-change monitoring", async () => {
    const invoke = vi.fn().mockResolvedValue({
      path: "main.scad",
      text: true,
      contentsBase64: "Y3ViZSgxKTs=",
    });
    const storage = createTauriProjectStorage(invoke);

    expect(storage.read).toBeTypeOf("function");
    await expect(storage.read?.("C:\\Models\\Gear", "main.scad")).resolves.toBe("cube(1);");
    expect(invoke).toHaveBeenCalledWith("project_read", {
      projectId: "C:\\Models\\Gear",
      path: "main.scad",
    });
  });

  it("writes, moves, trashes, and reveals through typed project commands", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const storage = createTauriProjectStorage(invoke);

    await storage.write("project", "main.scad", "cube(2);");
    await storage.write("project", "asset.bin", new Uint8Array([1, 2, 255]));
    await storage.move("project", "main.scad", "parts/main.scad");
    await storage.trash("project", "parts/main.scad");
    await storage.reveal("project", "asset.bin");

    expect(invoke.mock.calls).toEqual([
      ["project_write", {
        projectId: "project",
        path: "main.scad",
        text: true,
        contentsBase64: "Y3ViZSgyKTs=",
      }],
      ["project_write", {
        projectId: "project",
        path: "asset.bin",
        text: false,
        contentsBase64: "AQL/",
      }],
      ["project_move", { projectId: "project", from: "main.scad", to: "parts/main.scad" }],
      ["project_trash", { projectId: "project", path: "parts/main.scad" }],
      ["project_reveal", { projectId: "project", path: "asset.bin" }],
    ]);
  });

  it("rejects malformed native snapshot payloads without returning partial state", async () => {
    const invoke = vi.fn().mockResolvedValue([
      { path: "main.scad", text: true, contentsBase64: "!not-base64!" },
    ]);

    await expect(createTauriProjectStorage(invoke).snapshot("project")).rejects.toThrow();
  });
});
