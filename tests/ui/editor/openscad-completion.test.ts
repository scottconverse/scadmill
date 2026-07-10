// @vitest-environment happy-dom
import {
  CompletionContext,
  type CompletionResult,
  type CompletionSource,
  completionStatus,
  currentCompletions,
  selectedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";

import {
  OPENSCAD_BUILTIN_FUNCTIONS,
  OPENSCAD_BUILTIN_MODULES,
  OPENSCAD_CONTEXTUAL_BUILTINS,
  OPENSCAD_SPECIAL_VARIABLES,
} from "../../../src/ui/editor/openscad-builtins";
import {
  OPENSCAD_COMPLETIONS,
  openScadCompletionSource,
} from "../../../src/ui/editor/openscad-completion";
import { codeEditorTheme } from "../../../src/ui/editor/code-editor-theme";
import { openScad } from "../../../src/ui/editor/openscad-language";

async function complete(
  doc: string,
  pos = doc.length,
  explicit = false,
): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc, extensions: [openScad()] });
  return await openScadCompletionSource(new CompletionContext(state, pos, explicit));
}

describe("OpenSCAD completion", () => {
  it("offers cube with a signature, description, and provisional named-argument skeleton", async () => {
    const result = await complete("cub");
    const cube = result?.options.find((option) => option.label === "cube");

    expect(result?.from).toBe(0);
    expect(cube).toMatchObject({
      detail: "cube(size = 1, center = false)",
      info: "Create a cube or rectangular box.",
      apply: "cube(size = 1, center = false);",
      type: "function",
    });
    expect(typeof cube?.apply).toBe("string");
    if (typeof cube?.apply === "string" && result) {
      const accepted = EditorState.create({ doc: "cub" }).update({
        changes: { from: result.from, to: 3, insert: cube.apply },
      });
      expect(accepted.state.doc.toString()).toBe("cube(size = 1, center = false);");
    }
  });

  it("filters statement, expression, and special-variable contexts", async () => {
    const statement = await complete("cub");
    const expression = await complete("value = si");
    const expressionAfterBindings = await complete("value = let(x = 1) si");
    const specialVariable = await complete("$f");

    expect(statement?.options.map(({ label }) => label)).toContain("cube");
    expect(statement?.options.map(({ label }) => label)).toContain("let");
    expect(statement?.options.map(({ label }) => label)).not.toContain("sin");
    expect(expression?.options.map(({ label }) => label)).toContain("sin");
    expect(expression?.options.map(({ label }) => label)).toContain("let");
    expect(expression?.options.map(({ label }) => label)).not.toContain("sphere");
    expect(expressionAfterBindings?.options.map(({ label }) => label)).toContain("sin");
    expect(expressionAfterBindings?.options.map(({ label }) => label)).not.toContain("sphere");
    expect(specialVariable?.options.length).toBeGreaterThan(0);
    expect(specialVariable?.options.every(({ label }) => label.startsWith("$"))).toBe(true);
  });

  it("does not complete inside comments, strings, paths, or declaration names", async () => {
    expect(await complete("// cub")).toBeNull();
    expect(await complete("/* cub")).toBeNull();
    expect(await complete('label = "cube";', 9)).toBeNull();
    expect(await complete('text("cub')).toBeNull();
    expect(await complete("include <cube.scad>", 13)).toBeNull();
    expect(await complete("include <cub")).toBeNull();
    expect(await complete("module cub")).toBeNull();
    expect(await complete("function si")).toBeNull();
    expect(await complete("module part(wi")).toBeNull();
    expect(await complete("function twice(val")).toBeNull();
    expect(await complete("module part(a = sin(30), wi")).toBeNull();
    expect(await complete("function twice(a = sin(30), val")).toBeNull();
  });

  it("provides metadata for every name in the version-labeled provisional corpus", () => {
    const expectedNames = new Set([
      ...OPENSCAD_BUILTIN_MODULES,
      ...OPENSCAD_BUILTIN_FUNCTIONS,
      ...OPENSCAD_CONTEXTUAL_BUILTINS,
      ...OPENSCAD_SPECIAL_VARIABLES,
    ]);
    const actualNames = new Set(OPENSCAD_COMPLETIONS.map(({ label }) => label));

    expect(actualNames).toEqual(expectedNames);
    expect(OPENSCAD_COMPLETIONS.every(({ detail, info }) => detail.length > 0 && info.length > 0)).toBe(
      true,
    );
    expect(OPENSCAD_COMPLETIONS.every(({ detail }) => detail === detail.trim())).toBe(true);
  });

  it("uses release-accurate defaults in representative signatures", () => {
    const detail = (label: string) =>
      OPENSCAD_COMPLETIONS.find((completion) => completion.label === label)?.detail;

    expect(detail("linear_extrude")).toBe(
      "linear_extrude(height = 100, center = false, convexity = 1, twist = 0, slices = undef, scale = 1)",
    );
    expect(detail("text")).toBe(
      'text(text = "", size = 10, font = "", direction = "ltr", language = "en", script = "latin", halign = "left", valign = "baseline", spacing = 1)',
    );
    expect(detail("import")).toBe(
      "import(file, layer = undef, convexity = 1, origin = [0, 0], scale = 1)",
    );
    expect(detail("parent_module")).toBe("parent_module(index = 1)");
    expect(detail("polygon")).toBe("polygon(points = undef, paths = undef, convexity = 1)");
    expect(detail("polyhedron")).toBe(
      "polyhedron(points = undef, faces = undef, convexity = 1)",
    );
    expect(detail("let")).toBe("let(bindings) expression");
  });

  it("registers the completion source with the live OpenSCAD language support", () => {
    const state = EditorState.create({ doc: "cub", extensions: [openScad()] });
    const sources = state.languageDataAt<CompletionSource>("autocomplete", 3);

    expect(sources).toContain(openScadCompletionSource);
  });

  it("opens the live CodeMirror list and accepts cube through the Enter keybinding", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "cub",
        selection: { anchor: 3 },
        extensions: [basicSetup, openScad(), codeEditorTheme],
      }),
    });

    try {
      expect(startCompletion(view)).toBe(true);
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
      expect(currentCompletions(view.state)).toContainEqual(
        expect.objectContaining({ label: "cube", detail: "cube(size = 1, center = false)" }),
      );
      await vi.waitFor(() => expect(selectedCompletion(view.state)?.label).toBe("cube"));
      expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 100));
      fireEvent.keyDown(view.contentDOM, { key: "Enter", code: "Enter", charCode: 13 });
      expect(view.state.doc.toString()).toBe("cube(size = 1, center = false);");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("completes current-file modules, functions, and variables in their valid contexts", async () => {
    const declarations = `module bracket(width = 10, center = false) { cube(width); }
function twice(value, factor = 2) = value * factor;
thickness = 3;`;
    const statement = await complete(`${declarations}\nbra`);
    const expression = await complete(`${declarations}\nresult = tw`);
    const variableExpression = await complete(`${declarations}\nresult = thi`);
    const bracket = statement?.options.find(({ label }) => label === "bracket");

    expect(bracket).toMatchObject({
      detail: "bracket(width = 10, center = false)",
      info: "Module defined in the current file.",
      type: "function",
    });
    expect(statement?.options.map(({ label }) => label)).not.toContain("twice");
    expect(expression?.options.map(({ label }) => label)).toContain("twice");
    expect(expression?.options.map(({ label }) => label)).not.toContain("bracket");
    expect(variableExpression?.options.map(({ label }) => label)).toContain("thickness");
  });

  it("lets current-file declarations shadow a built-in completion", async () => {
    const result = await complete("module cube(edge = 2) { }\ncub");
    const cubes = result?.options.filter(({ label }) => label === "cube") ?? [];

    expect(cubes).toHaveLength(1);
    expect(cubes[0]).toMatchObject({
      detail: "cube(edge = 2)",
      info: "Module defined in the current file.",
      boost: 10,
    });
  });

  it("keeps function and variable namespaces distinct when labels collide", async () => {
    const result = await complete("sin = 1;\nresult = si");
    const sinOptions = result?.options.filter(({ label }) => label === "sin") ?? [];

    expect(sinOptions).toHaveLength(2);
    expect(sinOptions.map(({ detail }) => detail)).toEqual(expect.arrayContaining(["sin(x)", "variable"]));
  });

  it("does not leak a nested assignment into top-level completion", async () => {
    const result = await complete("module outer() { inner = 1; }\nresult = inn");

    expect(result?.options.map(({ label }) => label)).not.toContain("inner");
  });

  it("completes parameters, locals, and iterator bindings only inside their scopes", async () => {
    const moduleSource = `global_value = 0;
module part(param = 1) {
  local_value = 2;
  result = par;
}`;
    const functionSource = "function twice(value) = val;";
    const forSource = "for (item = [0:1]) echo(ite);";
    const letSource = "let (bound = 1) echo(bou);";
    const insideModule = await complete(moduleSource, moduleSource.lastIndexOf("par;") + 3);
    const insideFunction = await complete(functionSource, functionSource.lastIndexOf("val;") + 3);
    const insideFor = await complete(forSource, forSource.lastIndexOf("ite)") + 3);
    const insideLet = await complete(letSource, letSource.lastIndexOf("bou)") + 3);

    expect(insideModule?.options.map(({ label }) => label)).toEqual(
      expect.arrayContaining(["global_value", "param", "local_value"]),
    );
    expect(insideFunction?.options.map(({ label }) => label)).toContain("value");
    expect(insideFor?.options.map(({ label }) => label)).toContain("item");
    expect(insideLet?.options.map(({ label }) => label)).toContain("bound");
  });
});
