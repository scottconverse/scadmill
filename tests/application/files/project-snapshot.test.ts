import { describe, expect, it } from "vitest";
import {
  buildRenderFileMap,
  createProjectSnapshot,
} from "../../../src/application/files/project-snapshot";

describe("complete project snapshots", () => {
  it("overlays open text buffers without dropping unopened or binary files", () => {
    const mesh = new Uint8Array([0, 255, 17, 42]);
    const snapshot = createProjectSnapshot(
      "project-1",
      new Map<string, string | Uint8Array>([
        ["main.scad", "include <parts/body.scad>;"],
        ["parts/body.scad", "cube(1);"],
        ["notes.txt", "unopened"],
        ["assets/reference.stl", mesh],
      ]),
    );

    expect(snapshot.workspaceIdentity).toBe("project-1");
    const files = buildRenderFileMap(snapshot, [
      { documentId: "doc-main", path: "main.scad", source: "include <parts/body.scad>; // edited" },
      { documentId: "doc-body", path: "parts/body.scad", source: "cube(2);" },
    ]);

    expect([...files.keys()]).toEqual([
      "assets/reference.stl",
      "main.scad",
      "notes.txt",
      "parts/body.scad",
    ]);
    expect(files.get("main.scad")).toBe("include <parts/body.scad>; // edited");
    expect(files.get("parts/body.scad")).toBe("cube(2);");
    expect(files.get("notes.txt")).toBe("unopened");
    expect(files.get("assets/reference.stl")).toEqual(mesh);
    expect(files.get("assets/reference.stl")).not.toBe(mesh);
  });

  it("rejects an overlay path absent from the project snapshot", () => {
    const snapshot = createProjectSnapshot(
      "project-1",
      new Map([["main.scad", "cube(1);"]]),
    );

    expect(() =>
      buildRenderFileMap(snapshot, [
        { documentId: "doc-other", path: "other.scad", source: "cube(2);" },
      ]),
    ).toThrow(/not present/i);
  });

  it("takes defensive copies of binary bytes on ingress and egress", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const snapshot = createProjectSnapshot("project-1", new Map([["asset.bin", bytes]]));
    bytes[0] = 9;

    const first = buildRenderFileMap(snapshot, []).get("asset.bin") as Uint8Array;
    first[1] = 8;
    const second = buildRenderFileMap(snapshot, []).get("asset.bin") as Uint8Array;

    expect([...second]).toEqual([1, 2, 3]);
  });

  it("accepts an opaque workspace identity distinct from the user-facing project id", () => {
    const snapshot = createProjectSnapshot(
      "C:\\Models\\Gear",
      new Map([["main.scad", "cube(1);"]]),
      `desktop-project:${"a".repeat(64)}`,
    );

    expect(snapshot.workspaceIdentity).toBe(`desktop-project:${"a".repeat(64)}`);
    expect(() => createProjectSnapshot("project-1", new Map(), " ")).toThrow(
      /workspace identity must be non-empty/iu,
    );
  });
});
