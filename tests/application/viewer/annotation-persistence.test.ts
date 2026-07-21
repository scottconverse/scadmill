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
    expect(repository.state()).toEqual({ status: "load-error" });
  });

  it("retains the exact unsaved versioned snapshot until a retry durably saves it", () => {
    let blocked = true;
    let saved: string | null = null;
    const repository = new WorkspaceAnnotationRepository({
      load: () => null,
      save: (serialized) => {
        if (blocked) throw new Error("Quota exceeded.");
        saved = serialized;
      },
    });

    expect(() => repository.replace("project-a", "main.scad", [
      { id: "note", point: [1, 2, 3], text: "Unsaved note" },
    ])).toThrow(/quota/iu);
    expect(repository.state()).toEqual({ status: "unsaved" });
    expect(repository.serializeCurrent()).toBe(
      '{"version":1,"files":[{"projectId":"project-a","path":"main.scad","annotations":[{"id":"note","point":[1,2,3],"text":"Unsaved note"}]}]}',
    );
    expect(() => repository.retry()).toThrow(/quota/iu);
    expect(repository.state()).toEqual({ status: "unsaved" });

    blocked = false;
    repository.retry();

    expect(repository.state()).toEqual({ status: "saved" });
    expect(saved).toBe(repository.serializeCurrent());
    const restored = new WorkspaceAnnotationRepository({
      load: () => saved,
      save: () => undefined,
    });
    expect(restored.annotations("project-a", "main.scad")).toEqual([
      { id: "note", point: [1, 2, 3], text: "Unsaved note" },
    ]);
  });

  it("retries an initial load failure without overwriting the durable metadata", () => {
    let blocked = true;
    const serialized = serializeWorkspaceAnnotationMetadata({
      version: 1,
      files: [{
        projectId: "project-a",
        path: "main.scad",
        annotations: [{ id: "restored", point: [9, 8, 7], text: "Recovered" }],
      }],
    });
    const save = vi.fn();
    const repository = new WorkspaceAnnotationRepository({
      load: () => {
        if (blocked) throw new Error("Storage read blocked.");
        return serialized;
      },
      save,
    });
    expect(repository.state()).toEqual({ status: "load-error" });

    blocked = false;
    repository.retry();

    expect(repository.state()).toEqual({ status: "saved" });
    expect(repository.annotations("project-a", "main.scad")).toEqual([
      { id: "restored", point: [9, 8, 7], text: "Recovered" },
    ]);
    expect(save).not.toHaveBeenCalled();
  });

  it("does not overwrite unreadable durable metadata until the user explicitly retries", () => {
    let blocked = true;
    const save = vi.fn(() => {
      if (blocked) throw new Error("Quota exceeded.");
    });
    const repository = new WorkspaceAnnotationRepository({
      load: () => "{corrupt",
      save,
    });
    expect(repository.state()).toEqual({ status: "load-error" });

    repository.replace("project-a", "main.scad", [
      { id: "new-note", point: [1, 2, 3], text: "Kept in memory" },
    ]);

    expect(save).not.toHaveBeenCalled();
    expect(repository.state()).toEqual({ status: "load-error-unsaved" });
    expect(repository.serializeCurrent()).toContain("new-note");
    expect(() => repository.retry()).toThrow(/quota/iu);
    expect(repository.state()).toEqual({ status: "load-error-unsaved" });

    blocked = false;
    repository.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(repository.state()).toEqual({ status: "saved" });
  });
});
