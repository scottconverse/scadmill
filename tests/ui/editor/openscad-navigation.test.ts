import { describe, expect, it } from "vitest";

import {
  findOpenScadDefinition,
  findOpenScadReferences,
  outlineOpenScadFile,
} from "../../../src/ui/editor/openscad-navigation";

describe("OpenSCAD structural navigation", () => {
  it("outlines only top-level modules, functions, and variables with source locations", () => {
    const source = [
      "size = 8;",
      "module bracket(width = size) {",
      "  local = width / 2;",
      "  cube(local);",
      "}",
      "function doubled(value) = value * 2;",
    ].join("\n");

    expect(outlineOpenScadFile(source, "parts/bracket.scad")).toEqual([
      expect.objectContaining({ label: "size", symbolKind: "variable", line: 1, column: 1 }),
      expect.objectContaining({ label: "bracket", symbolKind: "module", line: 2, column: 8 }),
      expect.objectContaining({ label: "doubled", symbolKind: "function", line: 6, column: 10 }),
    ]);
  });

  it("resolves a module call through use to the exact definition location", () => {
    const source = "use <b.scad>\nbracket();";
    const sources = new Map([
      ["a.scad", source],
      ["b.scad", "module bracket(width = 4) { cube(width); }"],
    ]);

    expect(findOpenScadDefinition(sources, "a.scad", source.indexOf("bracket") + 2))
      .toEqual(expect.objectContaining({
        path: "b.scad",
        label: "bracket",
        symbolKind: "module",
        line: 1,
        column: 8,
      }));
  });

  it("finds real references across project files without matching comments or strings", () => {
    const definition = "module bracket() {}";
    const a = "use <b.scad>\nbracket(); // bracket()";
    const c = 'include <b.scad>\necho("bracket");\nbracket();';
    const sources = new Map([
      ["a.scad", a],
      ["b.scad", definition],
      ["c.scad", c],
    ]);

    const references = findOpenScadReferences(
      sources,
      "b.scad",
      definition.indexOf("bracket") + 1,
    );

    expect(references.map(({ path, line, column }) => ({ path, line, column }))).toEqual([
      { path: "a.scad", line: 2, column: 1 },
      { path: "c.scad", line: 3, column: 1 },
    ]);
  });

  it("bounds cyclic reference graphs and returns no target for unknown symbols", () => {
    const source = "include <b.scad>\nmissing();";
    const sources = new Map([
      ["a.scad", source],
      ["b.scad", "include <a.scad>\nmodule other() {}"],
    ]);

    expect(findOpenScadDefinition(sources, "a.scad", source.indexOf("missing") + 1))
      .toBeUndefined();
  });
});
