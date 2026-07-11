import { describe, expect, it } from "vitest";

import {
  detectExternalChange,
  resolveExternalChange,
} from "../../../src/application/files/external-change";

describe("external changes", () => {
  it("raises a conflict only when disk content diverges from the last saved snapshot", () => {
    expect(detectExternalChange("cube(10);", "cube(12);", "cube(10);")).toBeNull();
    expect(detectExternalChange("cube(10);", "cube(12);", "cube(20);")).toEqual({
      kind: "modified",
      diskSource: "cube(20);",
      localSource: "cube(12);",
      savedSource: "cube(10);",
    });
  });

  it("distinguishes a deleted open file from a content edit", () => {
    expect(detectExternalChange("cube(10);", "cube(12);", undefined)).toEqual({
      kind: "deleted",
      localSource: "cube(12);",
      savedSource: "cube(10);",
    });
  });

  it("distinguishes a binary replacement from a content edit", () => {
    expect(detectExternalChange("cube(10);", "cube(12);", new Uint8Array([0, 255]))).toEqual({
      kind: "type-changed",
      localSource: "cube(12);",
      savedSource: "cube(10);",
    });
  });

  it("supports reload, keep, and non-mutating diff choices", () => {
    const conflict = detectExternalChange("cube(10);", "cube(12);", "cube(20);");
    if (!conflict) throw new Error("Expected conflict");

    expect(resolveExternalChange(conflict, "reload")).toEqual({
      source: "cube(20);",
      savedSource: "cube(20);",
      dirty: false,
    });
    expect(resolveExternalChange(conflict, "keep")).toEqual({
      source: "cube(12);",
      savedSource: "cube(20);",
      dirty: true,
    });
    expect(resolveExternalChange(conflict, "diff")).toEqual({
      before: "cube(12);",
      after: "cube(20);",
    });
  });
});
