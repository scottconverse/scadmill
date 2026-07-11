import { describe, expect, it } from "vitest";

import { createDocumentWorkspace } from "../../../src/application/documents/document-workspace";
import { parseProjectPath } from "../../../src/application/files/project-path";
import { createProjectSessionState } from "../../../src/application/files/project-session";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { buildRuntimeTextFileMap } from "../../../src/application/runtime/project-render-files";

describe("runtime project file maps", () => {
  it("builds a text-only project map with open buffers as the authority", () => {
    const snapshot = createProjectSnapshot(
      "completion-project",
      new Map<string, string | Uint8Array>([
        ["main.scad", "cube(1);"],
        ["lib/part.scad", "module part() {}"],
        ["assets/mesh.stl", Uint8Array.of(1, 2, 3)],
      ]),
    );
    const project = createProjectSessionState(snapshot, "project");
    const workspace = createDocumentWorkspace([
      { id: "main", path: "main.scad", source: "cube(2);" },
      { id: "notes", path: "notes.scad", source: "echo(\"open\");" },
    ]);

    expect(buildRuntimeTextFileMap(project, workspace)).toEqual(new Map([
      ["main.scad", "cube(2);"],
      ["lib/part.scad", "module part() {}"],
      ["notes.scad", "echo(\"open\");"],
    ]));
    expect(snapshot.files.get(parseProjectPath("main.scad"))).toBe("cube(1);");
  });
});
