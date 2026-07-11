import { describe, expect, it, vi } from "vitest";

import {
  parseWorkspaceAnnotationMetadata,
  serializeWorkspaceAnnotationMetadata,
  WorkspaceAnnotationRepository,
} from "../../../src/application/viewer/annotation-persistence";

describe("workspace annotation metadata", () => {
  it("round-trips a deterministic versioned project-and-file payload", () => {
    const serialized = serializeWorkspaceAnnotationMetadata({
      version: 1,
      files: [
        {
          projectId: "project-b",
          path: "parts/wheel.scad",
          annotations: [{ id: "b", point: [4, 5, 6], text: "Wheel" }],
        },
        {
          projectId: "project-a",
          path: "main.scad",
          annotations: [{ id: "a", point: [1, 2, 3], text: "Main" }],
        },
      ],
    });

    expect(JSON.parse(serialized).files.map(({ projectId }: { projectId: string }) => projectId))
      .toEqual(["project-a", "project-b"]);
    expect(parseWorkspaceAnnotationMetadata(serialized)).toEqual({
      version: 1,
      files: [
        {
          projectId: "project-a",
          path: "main.scad",
          annotations: [{ id: "a", point: [1, 2, 3], text: "Main" }],
        },
        {
          projectId: "project-b",
          path: "parts/wheel.scad",
          annotations: [{ id: "b", point: [4, 5, 6], text: "Wheel" }],
        },
      ],
    });
  });

  it("rejects case-colliding file keys and hostile annotation records", () => {
    const collision = JSON.stringify({
      version: 1,
      files: [
        { projectId: "project-a", path: "Main.scad", annotations: [] },
        { projectId: "project-a", path: "main.scad", annotations: [] },
      ],
    });
    const hostile = '{"version":1,"files":[{"projectId":"project-a","path":"main.scad",'
      + '"annotations":[{"id":"note","point":[0,0,1e999],"text":"bad"}]}]}';

    expect(() => parseWorkspaceAnnotationMetadata(collision)).toThrow(/unique/iu);
    expect(() => parseWorkspaceAnnotationMetadata(hostile)).toThrow();
  });

  it("bounds metadata and fails closed on malformed durable state", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    expect(() => parseWorkspaceAnnotationMetadata("x".repeat(1_048_577))).toThrow(/size/iu);
    expect(encode).not.toHaveBeenCalled();
    const repository = new WorkspaceAnnotationRepository({
      load: () => "{bad",
      save: () => undefined,
    });
    expect(repository.annotations("project-a", "main.scad")).toEqual([]);
  });
});
