import { describe, expect, it } from "vitest";

import {
  planProjectTextReplacement,
  searchProjectText,
} from "../../../src/application/navigation/project-text-search";

const FILES = new Map<string, string>([
  [".gitignore", "vendor/\n"],
  [".scadmillignore", "generated/**\n"],
  ["main.scad", "cube(10);\nCube(20);\n"],
  ["src/part.scad", "translate([1, 0, 0]) cube(5);\n"],
  ["generated/copy.scad", "cube(99);\n"],
  ["vendor/library.scad", "cube(88);\n"],
]);

describe("project text search", () => {
  it("searches text files with locations while respecting project ignore patterns", () => {
    const result = searchProjectText(FILES, { query: "cube", caseSensitive: false });

    expect(result.matches).toEqual([
      expect.objectContaining({ path: "main.scad", line: 1, column: 1, text: "cube(10);" }),
      expect.objectContaining({ path: "main.scad", line: 2, column: 1, text: "Cube(20);" }),
      expect.objectContaining({ path: "src/part.scad", line: 1, column: 22 }),
    ]);
    expect(result.searchedFiles).toBe(4);
    expect(result.ignoredFiles).toEqual(["generated/copy.scad", "vendor/library.scad"]);
    expect(result.truncated).toBe(false);
  });

  it("supports whole-word matching without treating the query as a regular expression", () => {
    const files = new Map([
      ["main.scad", "part(); partial(); part_2(); part();"],
    ]);

    expect(searchProjectText(files, { query: "part", wholeWord: true }).matches)
      .toHaveLength(2);
    expect(searchProjectText(files, { query: "part()" }).matches).toHaveLength(2);
  });

  it("plans deterministic replacements without mutating the input map", () => {
    const plan = planProjectTextReplacement(FILES, {
      query: "cube",
      replacement: "sphere",
      caseSensitive: false,
    });

    expect(plan.matchCount).toBe(3);
    expect(plan.files).toEqual([
      { path: "main.scad", source: "sphere(10);\nsphere(20);\n", replacements: 2 },
      { path: "src/part.scad", source: "translate([1, 0, 0]) sphere(5);\n", replacements: 1 },
    ]);
    expect(FILES.get("main.scad")).toBe("cube(10);\nCube(20);\n");
  });

  it("rejects an empty query and caps adversarial result counts", () => {
    expect(() => searchProjectText(FILES, { query: "" })).toThrow("non-empty");
    const result = searchProjectText(
      new Map([["many.scad", "x".repeat(10_000)]]),
      { query: "x", maximumMatches: 25 },
    );

    expect(result.matches).toHaveLength(25);
    expect(result.truncated).toBe(true);
  });
});
