import { describe, expect, it } from "vitest";

import {
  createDocumentWorkspace,
  isDocumentDirty,
  reduceDocumentWorkspace,
} from "../../../src/application/documents/document-workspace";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import {
  createProjectSessionState,
  executeProjectCommand,
} from "../../../src/application/files/project-session";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";

function memoryStorage(initial: ReadonlyMap<string, ProjectFileContent>): ProjectStorage {
  const files = new Map(initial);
  return {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    write: async (_projectId, path, content) => { files.set(path, content); },
    move: async (_projectId, from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error("missing");
      files.delete(from);
      files.set(to, content);
    },
    trash: async (_projectId, path) => { files.delete(path); },
    reveal: async () => undefined,
  };
}

const context = (storage?: ProjectStorage) => ({
  storage,
  makeDocumentId: () => "opened-document",
  now: () => new Date("2026-07-10T23:00:00.000Z"),
});

describe("project session commands", () => {
  it("opens a confirmed project at one text entry and records it as recent", async () => {
    const scratch = createProjectSnapshot("scratch", new Map([["main.scad", "cube(1);"]]));
    const project = createProjectSnapshot("project-a", new Map<string, ProjectFileContent>([
      ["assembly.scad", "include <parts/wheel.scad>\nwheel();"],
      ["parts/wheel.scad", "module wheel() { cylinder(4); }"],
      ["asset.stl", new Uint8Array([0, 1, 2])],
    ]));

    const transition = await executeProjectCommand(
      createProjectSessionState(scratch),
      createDocumentWorkspace(),
      {
        kind: "replace-project-confirmed",
        snapshot: project,
        displayName: "Project A",
        entryFile: "assembly.scad",
      },
      context(),
    );

    expect(transition?.project).toMatchObject({
      mode: "project",
      displayName: "Project A",
      revision: 1,
      recentProjects: [{
        projectId: "project-a",
        displayName: "Project A",
        openedAt: "2026-07-10T23:00:00.000Z",
      }],
    });
    expect(transition?.replacementWorkspace?.documents).toEqual([{
      id: "opened-document",
      path: "assembly.scad",
      source: "include <parts/wheel.scad>\nwheel();",
      savedSource: "include <parts/wheel.scad>\nwheel();",
      revision: 0,
      savedRevision: 0,
    }]);
  });

  it("opens an unloaded text target while selecting binary files without coercion", async () => {
    const snapshot = createProjectSnapshot("project-a", new Map<string, ProjectFileContent>([
      ["main.scad", "cube(1);"],
      ["parts/wheel.scad", "sphere(2);"],
      ["asset.stl", new Uint8Array([0, 255])],
    ]));
    const state = createProjectSessionState(snapshot, "project", "Project A");
    const workspace = createDocumentWorkspace([{ id: "main", path: "main.scad", source: "cube(1);" }]);

    const text = await executeProjectCommand(
      state,
      workspace,
      { kind: "open-project-file", path: "parts/wheel.scad" },
      context(),
    );
    const binary = await executeProjectCommand(
      state,
      workspace,
      { kind: "open-project-file", path: "asset.stl" },
      context(),
    );

    expect(text?.documentActions).toEqual([{
      kind: "open",
      document: { id: "opened-document", path: "parts/wheel.scad", source: "sphere(2);" },
    }]);
    expect(binary?.project.selectedBinaryPath).toBe("asset.stl");
    expect(binary?.documentActions).toEqual([]);
  });

  it("saves the captured revision without hiding a later edit", async () => {
    const files = new Map<string, ProjectFileContent>([["main.scad", "cube(1);"]]);
    const storage = memoryStorage(files);
    const state = createProjectSessionState(
      createProjectSnapshot("project-a", files),
      "project",
      "Project A",
    );
    let workspace = reduceDocumentWorkspace(
      createDocumentWorkspace([{ id: "main", path: "main.scad", source: "cube(1);" }]),
      { kind: "edit", documentId: "main", source: "cube(2);" },
    );

    const transition = await executeProjectCommand(
      state,
      workspace,
      { kind: "save-document", documentId: "main" },
      context(storage),
    );
    workspace = reduceDocumentWorkspace(workspace, {
      kind: "edit",
      documentId: "main",
      source: "cube(3);",
    });
    for (const action of transition?.documentActions ?? []) {
      workspace = reduceDocumentWorkspace(workspace, action);
    }

    expect(transition?.project.snapshot.files.get("main.scad" as never)).toBe("cube(2);");
    expect(workspace.documents[0]).toMatchObject({ source: "cube(3);", savedSource: "cube(2);" });
    expect(isDocumentDirty(workspace.documents[0])).toBe(true);
  });
});
