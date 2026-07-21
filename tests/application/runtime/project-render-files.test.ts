import { describe, expect, it } from "vitest";

import { createDocumentWorkspace } from "../../../src/application/documents/document-workspace";
import { parseProjectPath } from "../../../src/application/files/project-path";
import { createProjectSessionState } from "../../../src/application/files/project-session";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { createRuntimeTextFileLookup } from "../../../src/application/runtime/project-render-files";

describe("runtime project file maps", () => {
  it("reads text lazily with open buffers as the authority", () => {
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

    const sources = createRuntimeTextFileLookup(project.snapshot);
    sources.update(workspace);

    expect(sources.get("main.scad")).toBe("cube(2);");
    expect(sources.get("lib/part.scad")).toBe("module part() {}");
    expect(sources.get("notes.scad")).toBe("echo(\"open\");");
    expect(sources.get("assets/mesh.stl")).toBeUndefined();
    expect(snapshot.files.get(parseProjectPath("main.scad"))).toBe("cube(1);");
  });
});
