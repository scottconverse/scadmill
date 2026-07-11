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
import { fireEvent } from "@testing-library/dom";
import { basicSetup } from "codemirror";
import { describe, expect, it, vi } from "vitest";
import { codeEditorTheme } from "../../../src/ui/editor/code-editor-theme";
import { parser } from "../../../src/ui/editor/generated/openscad-parser";
import {
  OPENSCAD_BUILTIN_FUNCTIONS,
  OPENSCAD_BUILTIN_MODULES,
  OPENSCAD_CONTEXTUAL_BUILTINS,
  OPENSCAD_SPECIAL_VARIABLES,
} from "../../../src/ui/editor/openscad-builtins";
import {
  createOpenScadCompletionSource,
  OPENSCAD_COMPLETIONS,
  type OpenScadProjectCompletionContext,
  openScadCompletionSource,
} from "../../../src/ui/editor/openscad-completion";
import { openScad } from "../../../src/ui/editor/openscad-language";

async function complete(
  doc: string,
  pos = doc.length,
  explicit = false,
  project?: OpenScadProjectCompletionContext,
): Promise<CompletionResult | null> {
  const state = EditorState.create({ doc, extensions: [openScad()] });
  const source = project
    ? createOpenScadCompletionSource(() => project)
    : openScadCompletionSource;
  return await source(new CompletionContext(state, pos, explicit));
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

  it("completes context-valid declarations from referenced project files only", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <lib/shapes.scad>\nbr"],
        [
          "lib/shapes.scad",
          "module bracket(width = 10) { cube(width); }\nfunction twice(value) = value * 2;\nthickness = 3;",
        ],
        ["lib/unrelated.scad", "module unrelated() {}"],
      ]),
    };
    const statement = await complete("include <lib/shapes.scad>\nbr", undefined, false, project);
    const expression = await complete(
      "include <lib/shapes.scad>\nvalue = tw",
      undefined,
      false,
      project,
    );

    expect(statement?.options).toContainEqual(expect.objectContaining({
      label: "bracket",
      detail: "bracket(width = 10)",
    }));
    expect(statement?.options.map(({ label }) => label)).not.toContain("unrelated");
    expect(expression?.options.map(({ label }) => label)).toEqual(
      expect.arrayContaining(["twice", "thickness"]),
    );
  });

  it("follows transitive project references without looping through cycles or unsafe paths", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <lib/root.scad>\nnes"],
        [
          "lib/root.scad",
          "include <nested.scad>\ninclude <../../outside.scad>\nmodule root_part() {}",
        ],
        ["lib/nested.scad", "include <../main.scad>\nmodule nested_part(size = 4) {}"],
        ["outside.scad", "module escaped() {}"],
      ]),
    };

    const result = await complete("include <lib/root.scad>\nnes", undefined, false, project);

    expect(result?.options).toContainEqual(expect.objectContaining({
      label: "nested_part",
      detail: "nested_part(size = 4)",
    }));
    expect(result?.options.map(({ label }) => label)).not.toContain("escaped");
  });

  it("keeps variables behind include while use exposes only callable declarations", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "use <lib/defs.scad>\nvalue = se"],
        [
          "lib/defs.scad",
          "module shared_part() {}\nfunction shared_value() = 3;\nsecret_value = 9;",
        ],
      ]),
    };
    const statement = await complete("use <lib/defs.scad>\nsha", undefined, false, project);
    const expression = await complete(
      "use <lib/defs.scad>\nvalue = sh",
      undefined,
      false,
      project,
    );

    expect(statement?.options.map(({ label }) => label)).toContain("shared_part");
    expect(expression?.options.map(({ label }) => label)).toContain("shared_value");
    expect(expression?.options.map(({ label }) => label)).not.toContain("secret_value");
  });

  it("does not re-export a child use through a file reached by use", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "use <a.scad>\nfrom_"],
        ["a.scad", "use <b.scad>\nmodule from_a() {}"],
        ["b.scad", "module from_b() {}"],
      ]),
    };

    const result = await complete("use <a.scad>\nfrom_", undefined, false, project);

    expect(result?.options.map(({ label }) => label)).toContain("from_a");
    expect(result?.options.map(({ label }) => label)).not.toContain("from_b");
  });

  it("exports a child use reached through an include without leaking its variables", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <a.scad>\nfrom_"],
        ["a.scad", "use <b.scad>\nmodule from_a() {}\na_value = 1;"],
        ["b.scad", "module from_b() {}\nb_value = 2;"],
      ]),
    };

    const statement = await complete("include <a.scad>\nfrom_", undefined, false, project);
    const expression = await complete("include <a.scad>\nvalue = b_", undefined, false, project);

    expect(statement?.options.map(({ label }) => label)).toEqual(
      expect.arrayContaining(["from_a", "from_b"]),
    );
    expect(expression?.options.map(({ label }) => label)).not.toContain("b_value");
  });

  it("exports callable declarations from a child include through a root use", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "use <a.scad>\nfrom_"],
        ["a.scad", "include <b.scad>\nmodule from_a() {}\na_value = 1;"],
        ["b.scad", "module from_b() {}\nb_value = 2;"],
      ]),
    };

    const statement = await complete("use <a.scad>\nfrom_", undefined, false, project);
    const expression = await complete("use <a.scad>\nvalue = b_", undefined, false, project);

    expect(statement?.options.map(({ label }) => label)).toEqual(
      expect.arrayContaining(["from_a", "from_b"]),
    );
    expect(expression?.options.map(({ label }) => label)).not.toContain("b_value");
  });

  it("resolves root and nested references relative to the declaring file without escaping", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "models/main.scad",
      sources: new Map([
        ["models/main.scad", "include <parts/root.scad>\nfrom_"],
        [
          "models/parts/root.scad",
          [
            "include <sibling.scad>",
            "include <./dot.scad>",
            "include <../common.scad>",
            "include <../../../outside.scad>",
            "module from_root() {}",
          ].join("\n"),
        ],
        ["models/parts/sibling.scad", "module from_sibling() {}"],
        ["models/parts/dot.scad", "module from_dot() {}"],
        ["models/common.scad", "module from_common() {}"],
        ["outside.scad", "module from_escape() {}"],
      ]),
    };

    const result = await complete(
      "include <parts/root.scad>\nfrom_",
      undefined,
      false,
      project,
    );
    const labels = result?.options.map(({ label }) => label) ?? [];

    expect(labels).toEqual(expect.arrayContaining([
      "from_root",
      "from_sibling",
      "from_dot",
      "from_common",
    ]));
    expect(labels).not.toContain("from_escape");
  });

  it("preserves textual include order when duplicate declarations are nested", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <a.scad>\ninclude <b.scad>\ndu"],
        ["a.scad", "include <x.scad>\nmodule dup(a = 1) {}"],
        ["b.scad", "module dup(b = 2) {}"],
        ["x.scad", "module dup(x = 3) {}"],
      ]),
    };

    const result = await complete("include <a.scad>\ninclude <b.scad>\ndu", undefined, false, project);

    expect(result?.options.find(({ label }) => label === "dup")).toMatchObject({
      detail: "dup(b = 2)",
      info: "Module defined in project file b.scad.",
    });
  });

  it("replays cached files when a later textual include makes them authoritative again", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <a.scad>\ninclude <b.scad>\ninclude <a.scad>\ndu"],
        ["a.scad", "module duplicate(from_a = true) {}"],
        ["b.scad", "module duplicate(from_b = true) {}"],
      ]),
    };

    const result = await complete(
      "include <a.scad>\ninclude <b.scad>\ninclude <a.scad>\ndu",
      undefined,
      false,
      project,
    );

    expect(result?.options.find(({ label }) => label === "duplicate")).toMatchObject({
      detail: "duplicate(from_a = true)",
      info: "Module defined in project file a.scad.",
    });
  });

  it("caches unchanged referenced files and invalidates only changed source", async () => {
    let project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <lib.scad>\npa"],
        ["lib.scad", "module part(size = 1) {}"],
      ]),
    };
    const source = createOpenScadCompletionSource(() => project);
    const context = () => new CompletionContext(
      EditorState.create({ doc: "include <lib.scad>\npa", extensions: [openScad()] }),
      "include <lib.scad>\npa".length,
      false,
    );
    const parse = vi.spyOn(parser, "startParse");

    await source(context());
    await source(context());
    expect(parse).toHaveBeenCalledTimes(1);

    project = {
      ...project,
      sources: new Map([
        ["main.scad", "include <lib.scad>\npa"],
        ["lib.scad", "module panel(size = 2) {}"],
      ]),
    };
    const changed = await source(context());

    expect(parse).toHaveBeenCalledTimes(2);
    expect(changed?.options.map(({ label }) => label)).toContain("panel");
    parse.mockRestore();
  });

  it("indexes ordinary project symbols beyond the former 100,000-code-unit cutoff", async () => {
    const padding = `${"// padding\n".repeat(2_000)}`;
    const sources = new Map<string, string>();
    const fileCount = 6;
    for (let index = 0; index < fileCount; index += 1) {
      const next = index + 1 < fileCount ? `include <file-${index + 1}.scad>\n` : "";
      sources.set(
        `file-${index}.scad`,
        `${next}${padding}module bounded_${index}() {}`,
      );
    }
    sources.set("main.scad", "include <file-0.scad>\nbou");
    const result = await complete(
      "include <file-0.scad>\nbou",
      undefined,
      false,
      { documentPath: "main.scad", sources },
    );

    expect(result?.options.map(({ label }) => label)).toContain("bounded_0");
    expect(result?.options.map(({ label }) => label)).toContain("bounded_5");
  });

  it("bounds reference traversal even when most injected paths are absent", async () => {
    const missing = Array.from(
      { length: 600 },
      (_, index) => `include <missing-${index}.scad>`,
    ).join("\n");
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <fanout.scad>\nla"],
        ["fanout.scad", `${missing}\ninclude <late.scad>`],
        ["late.scad", "module late_symbol() {}"],
      ]),
    };

    const result = await complete("include <fanout.scad>\nla", undefined, false, project);

    expect(result?.options.map(({ label }) => label)).not.toContain("late_symbol");
  });

  it("bounds an adversarial 60,000-reference fanout without starving the event loop", async () => {
    const fanout = Array.from(
      { length: 60_000 },
      (_, index) => `include <missing-${index}.scad>`,
    ).join("\n");
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <fanout.scad>\nla"],
        ["fanout.scad", `${fanout}\ninclude <late.scad>`],
        ["late.scad", "module late_symbol() {}"],
      ]),
    };
    let heartbeat = false;
    setTimeout(() => {
      heartbeat = true;
    }, 0);

    const result = await complete("include <fanout.scad>\nla", undefined, false, project);

    expect(heartbeat).toBe(true);
    expect(result?.options.map(({ label }) => label)).not.toContain("late_symbol");
  });

  it("cooperatively indexes a two-million-code-unit file without starving the event loop", async () => {
    const declaration = "module million_scale_symbol(size = 3) {}";
    const source = `${" ".repeat(2_000_000 - declaration.length)}${declaration}`;
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <large.scad>\nmi"],
        ["large.scad", source],
      ]),
    };
    let heartbeat = false;
    setTimeout(() => {
      heartbeat = true;
    }, 0);

    const result = await complete("include <large.scad>\nmi", undefined, false, project);

    expect(heartbeat).toBe(true);
    expect(result?.options.map(({ label }) => label)).toContain("million_scale_symbol");
  });

  it("owns and disposes a dedicated project-index worker", async () => {
    const terminate = vi.fn();
    const postMessage = vi.fn();
    const construction = vi.fn();
    class TestWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      constructor() {
        construction();
      }

      postMessage(message: unknown) {
        postMessage(message);
      }

      terminate() {
        terminate();
      }
    }
    vi.stubGlobal("Worker", TestWorker);
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <lib.scad>\npa"],
        ["lib.scad", "module part() {}"],
      ]),
    };
    const source = createOpenScadCompletionSource(() => project) as CompletionSource & {
      dispose?: () => void;
    };
    const state = EditorState.create({
      doc: "include <lib.scad>\npa",
      extensions: [openScad()],
    });

    const pending = source(new CompletionContext(state, state.doc.length, false));

    expect(construction).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalled();
    expect(typeof source.dispose).toBe("function");
    source.dispose?.();
    expect(terminate).toHaveBeenCalledOnce();
    await expect(Promise.resolve(pending)).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("lets current-file declarations shadow same-named project declarations", async () => {
    const project: OpenScadProjectCompletionContext = {
      documentPath: "main.scad",
      sources: new Map([
        ["main.scad", "include <lib/shapes.scad>\nmodule bracket(size = 2) {}\nbr"],
        ["lib/shapes.scad", "module bracket(size = 20) {}"],
      ]),
    };
    const result = await complete(
      "include <lib/shapes.scad>\nmodule bracket(size = 2) {}\nbr",
      undefined,
      false,
      project,
    );
    const brackets = result?.options.filter(({ label }) => label === "bracket") ?? [];

    expect(brackets).toHaveLength(1);
    expect(brackets[0]).toMatchObject({
      detail: "bracket(size = 2)",
      info: "Module defined in the current file.",
      boost: 10,
    });
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
