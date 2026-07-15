import { describe, expect, it } from "vitest";

import { createDocumentWorkspace } from "../../../src/application/documents/document-workspace";
import { planRecoveryRestoration } from "../../../src/application/files/recovery-restoration";
import type {
  RecoveryBuffer,
  RecoverySnapshot,
} from "../../../src/application/files/recovery-state";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";

function recovery(
  buffers: readonly RecoveryBuffer[],
  projectId = "scratch",
): RecoverySnapshot {
  return {
    version: 1,
    projectId,
    capturedAt: "2026-07-10T00:00:00.000Z",
    buffers,
  };
}

describe("recovery restoration planning", () => {
  it("uses the snapshot's canonical path casing for a recovered project buffer", () => {
    const plan = planRecoveryRestoration(
      recovery([{
        documentId: "wheel",
        path: "parts/wheel.scad",
        source: "cylinder(8);",
        savedSource: "cylinder(4);",
      }], "project-a"),
      createDocumentWorkspace(),
      createProjectSnapshot("project-a", new Map([
        ["Parts/Wheel.scad", "cylinder(4);"],
      ])),
    );

    expect(plan.workspace.documents).toEqual([
      expect.objectContaining({
        id: "wheel",
        path: "Parts/Wheel.scad",
        source: "cylinder(8);",
        savedSource: "cylinder(4);",
      }),
    ]);
  });

  it.each([
    [
      "case-colliding paths",
      [
        { documentId: "one", path: "Part.scad", source: "cube(1);", savedSource: "cube(0);" },
        { documentId: "two", path: "part.scad", source: "cube(2);", savedSource: "cube(0);" },
      ],
    ],
    [
      "duplicate document ids",
      [
        { documentId: "same", path: "one.scad", source: "cube(1);", savedSource: "cube(0);" },
        { documentId: "same", path: "two.scad", source: "cube(2);", savedSource: "cube(0);" },
      ],
    ],
    [
      "a path that is also another buffer's parent",
      [
        { documentId: "parent", path: "parts", source: "cube(1);", savedSource: "cube(0);" },
        { documentId: "child", path: "parts/wheel.scad", source: "cube(2);", savedSource: "cube(0);" },
      ],
    ],
  ] satisfies readonly (readonly [string, readonly RecoveryBuffer[]])[])(
    "rejects %s before producing a workspace",
    (_caseName, buffers) => {
      const current = createDocumentWorkspace();
      const beforeDocuments = current.documents;

      expect(() => planRecoveryRestoration(recovery(buffers), current)).toThrow();
      expect(current.documents).toBe(beforeDocuments);
      expect(current.documents).toEqual([
        expect.objectContaining({ path: "main.scad", source: "cube(10);" }),
      ]);
    },
  );
});
