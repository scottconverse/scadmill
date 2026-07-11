import { describe, expect, it, vi } from "vitest";

import {
  ProjectFileService,
  type ProjectStorage,
} from "../../../src/application/files/project-file-service";
import { createProjectSnapshot, type ProjectFileContent } from "../../../src/application/files/project-snapshot";

function memoryStorage(initial: ReadonlyMap<string, ProjectFileContent> = new Map()) {
  const files = new Map(initial);
  const trashed: string[] = [];
  const revealed: string[] = [];
  const storage: ProjectStorage = {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    write: async (_projectId, path, content) => { files.set(path, content); },
    move: async (_projectId, from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error("missing");
      files.delete(from);
      files.set(to, content);
    },
    trash: async (_projectId, path) => { files.delete(path); trashed.push(path); },
    reveal: async (_projectId, path) => { revealed.push(path); },
  };
  return { files, revealed, storage, trashed };
}

describe("project file service", () => {
  it("creates, renames, moves, and trashes a file while preserving disk contents", async () => {
    const memory = memoryStorage(new Map([["main.scad", "cube(10);"]]));
    const service = new ProjectFileService("project-1", memory.storage);

    await service.createFile("parts/wheel.scad", "cylinder(r = 5, h = 2);");
    expect(memory.files.get("parts/wheel.scad")).toBe("cylinder(r = 5, h = 2);");

    await service.renameFile("parts/wheel.scad", "rim.scad");
    expect(memory.files.has("parts/wheel.scad")).toBe(false);
    expect(memory.files.get("parts/rim.scad")).toBe("cylinder(r = 5, h = 2);");

    await service.moveFile("parts/rim.scad", "assemblies/rim.scad");
    expect(memory.files.has("parts/rim.scad")).toBe(false);
    expect(memory.files.get("assemblies/rim.scad")).toBe("cylinder(r = 5, h = 2);");

    await service.deleteFile("assemblies/rim.scad");
    expect(memory.files.has("assemblies/rim.scad")).toBe(false);
    expect(memory.trashed).toEqual(["assemblies/rim.scad"]);
  });

  it("rejects collisions and unsafe rename leaves before touching storage", async () => {
    const memory = memoryStorage(new Map([
      ["main.scad", "cube(10);"],
      ["parts/rim.scad", "sphere(3);"],
    ]));
    const storage = {
      ...memory.storage,
      move: vi.fn(memory.storage.move),
      write: vi.fn(memory.storage.write),
    } satisfies ProjectStorage;
    const service = new ProjectFileService("project-1", storage);

    await expect(service.createFile("MAIN.scad")).rejects.toThrow(/collide/u);
    await expect(service.renameFile("parts/rim.scad", "../escape.scad")).rejects.toThrow(/file name/u);
    await expect(service.moveFile("parts/rim.scad", "main.scad")).rejects.toThrow(/collide/u);
    expect(storage.move).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it("requires existing paths and delegates reveal without mutating", async () => {
    const memory = memoryStorage(new Map([["main.scad", "cube(10);"]]));
    const service = new ProjectFileService("project-1", memory.storage);

    await expect(service.deleteFile("missing.scad")).rejects.toThrow(/does not exist/u);
    await service.revealFile("main.scad");
    expect(memory.revealed).toEqual(["main.scad"]);
    expect(memory.files.size).toBe(1);
  });
});
