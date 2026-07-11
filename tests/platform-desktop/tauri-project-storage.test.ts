import { describe, expect, it, vi } from "vitest";

import { createTauriProjectStorage } from "../../src/platform-desktop/tauri-project-storage";

describe("Tauri project storage", () => {
  it("loads one atomic canonical text-and-binary project snapshot", async () => {
    const canonicalPath = "\\\\?\\C:\\Models\\Gear";
    const invoke = vi.fn().mockResolvedValue({
      projectId: canonicalPath,
      workspaceIdentityMaterial: canonicalPath,
      files: [
        { path: "main.scad", text: true, contentsBase64: "Y3ViZSgxKTs=" },
        { path: "assets/reference.stl", text: false, contentsBase64: "AP8B" },
      ],
    });

    const snapshot = await createTauriProjectStorage(invoke).snapshot("C:\\Models\\Gear");

    expect(invoke).toHaveBeenCalledWith("project_snapshot", {
      projectId: "C:\\Models\\Gear",
    });
    expect(snapshot.projectId).toBe(canonicalPath);
    expect(snapshot.workspaceIdentity).toBe(
      "desktop-project:549f18b7074067c9438f1afe5f13cbd5bb3efe3f876285301dc7b68a6c92a8ba",
    );
    expect(snapshot.workspaceIdentity).not.toContain("Models");
    expect(snapshot.files.get("main.scad" as never)).toBe("cube(1);");
    expect(snapshot.files.get("assets/reference.stl" as never)).toEqual(
      new Uint8Array([0, 255, 1]),
    );
    await createTauriProjectStorage(invoke).write(snapshot.projectId, "main.scad", "cube(2);");
    expect(invoke.mock.calls).toEqual([
      ["project_snapshot", { projectId: "C:\\Models\\Gear" }],
      ["project_write", {
        projectId: canonicalPath,
        path: "main.scad",
        text: true,
        contentsBase64: "Y3ViZSgyKTs=",
      }],
    ]);
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
    const invoke = vi.fn().mockResolvedValue({
      projectId: "C:\\Models\\Gear",
      workspaceIdentityMaterial: "C:\\Models\\Gear",
      files: [{ path: "main.scad", text: true, contentsBase64: "!not-base64!" }],
    });

    await expect(createTauriProjectStorage(invoke).snapshot("project")).rejects.toThrow();
  });

  it("rejects an invalid native snapshot envelope", async () => {
    const invoke = vi.fn().mockResolvedValue({
      projectId: "C:\\Models\\Gear",
      workspaceIdentityMaterial: ["not", "a", "string"],
      files: [{ path: "main.scad", text: true, contentsBase64: "Y3ViZSgxKTs=" }],
    });

    await expect(createTauriProjectStorage(invoke).snapshot("project")).rejects.toThrow(
      "Native project snapshot has an invalid shape.",
    );
  });

  it("falls back to a non-persistable identity when hashing is unavailable", async () => {
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValueOnce(new Error("hash unavailable"));
    const invoke = vi.fn().mockResolvedValue({
      projectId: "C:\\Models\\Secret",
      workspaceIdentityMaterial: "C:\\Models\\Secret",
      files: [{ path: "main.scad", text: true, contentsBase64: "Y3ViZSgxKTs=" }],
    });

    try {
      const snapshot = await createTauriProjectStorage(invoke).snapshot("C:\\Models\\Secret");

      expect(snapshot.workspaceIdentity).toBe("desktop-ephemeral");
      expect(snapshot.workspaceIdentity).not.toContain("Models");
    } finally {
      digest.mockRestore();
    }
  });
});
