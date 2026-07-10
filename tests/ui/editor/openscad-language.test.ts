import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import {
  OPENSCAD_BUILTIN_FUNCTIONS,
  OPENSCAD_BUILTIN_MODULES,
  OPENSCAD_BUILTIN_REFERENCE,
} from "../../../src/ui/editor/openscad-builtins";
import { parseOpenScad } from "../../../src/ui/editor/openscad-language";
import { scadHighlightTags } from "../../../src/ui/editor/openscad-highlight-tags";

const tokenHighlighter = tagHighlighter([
  { tag: tags.keyword, class: "keyword" },
  { tag: tags.standard(tags.variableName), class: "builtin" },
  { tag: scadHighlightTags.userModule, class: "user-module" },
  { tag: tags.number, class: "number" },
  { tag: tags.string, class: "string" },
  { tag: tags.bool, class: "boolean" },
  { tag: scadHighlightTags.specialVariable, class: "special-variable" },
  { tag: tags.comment, class: "comment" },
  { tag: tags.operator, class: "operator" },
  { tag: scadHighlightTags.modifierChar, class: "modifier" },
  { tag: tags.punctuation, class: "punctuation" },
]);

interface ClassifiedToken {
  from: number;
  to: number;
  text: string;
  classes: string[];
}

function classify(source: string): ClassifiedToken[] {
  const tokens: ClassifiedToken[] = [];
  highlightTree(parseOpenScad(source), tokenHighlighter, (from, to, classes) => {
    tokens.push({ from, to, text: source.slice(from, to), classes: classes.split(" ") });
  });
  return tokens;
}

function tokenAt(
  source: string,
  tokens: readonly ClassifiedToken[],
  text: string,
  occurrence = 0,
): ClassifiedToken {
  const matches = tokens.filter((token) => token.text === text);
  expect(
    matches.length,
    `classified token ${JSON.stringify(text)} #${occurrence} in ${source.length}-character fixture`,
  ).toBeGreaterThan(occurrence);
  return matches[occurrence] as ClassifiedToken;
}

describe("OpenSCAD language highlighting", () => {
  it("classifies representative FR-1.2 token classes without parse recovery", () => {
    const source = `include <library/gears.scad>
$fn = 48;
enabled = true;
message = "ready";
module cap(size = 2) {
    #translate([1, 0, 0]) cube(size, center = false);
}
function twice(value) = value * 2;
if (enabled && $preview) !cap(); else echo("off");
// line comment
/* block comment */`;
    const tree = parseOpenScad(source);
    const tokens = classify(source);

    expect(tree.toString()).not.toContain("⚠");
    expect(tokenAt(source, tokens, "include").classes).toContain("keyword");
    expect(tokenAt(source, tokens, "module").classes).toContain("keyword");
    expect(tokenAt(source, tokens, "function").classes).toContain("keyword");
    expect(tokenAt(source, tokens, "if").classes).toContain("keyword");
    expect(tokenAt(source, tokens, "else").classes).toContain("keyword");
    expect(tokenAt(source, tokens, "translate").classes).toContain("builtin");
    expect(tokenAt(source, tokens, "cube").classes).toContain("builtin");
    expect(tokenAt(source, tokens, "echo").classes).toContain("builtin");
    expect(tokenAt(source, tokens, "cap").classes).toContain("user-module");
    expect(tokenAt(source, tokens, "48").classes).toContain("number");
    expect(tokenAt(source, tokens, '"ready"').classes).toContain("string");
    expect(tokenAt(source, tokens, "true").classes).toContain("boolean");
    expect(tokenAt(source, tokens, "$fn").classes).toContain("special-variable");
    expect(tokenAt(source, tokens, "$preview").classes).toContain("special-variable");
    expect(tokenAt(source, tokens, "// line comment").classes).toContain("comment");
    expect(tokenAt(source, tokens, "/* block comment */").classes).toContain("comment");
    expect(tokenAt(source, tokens, "&&").classes).toContain("operator");
    expect(tokenAt(source, tokens, "#").classes).toContain("modifier");
    expect(tokenAt(source, tokens, "(").classes).toContain("punctuation");
  });

  it("distinguishes statement-prefix modifiers from expression operators", () => {
    const source = `*sphere(1);
#cube(1);
%translate([0, 0, 0]) sphere(1);
!union() { cube(1); sphere(1); }
product = 2 * 3;
remainder = 5 % 2;
enabled = !false;
different = 1 != 2;`;
    const tokens = classify(source);

    expect(tokenAt(source, tokens, "*", 0).classes).toContain("modifier");
    expect(tokenAt(source, tokens, "*", 1).classes).toContain("operator");
    expect(tokenAt(source, tokens, "#").classes).toContain("modifier");
    expect(tokenAt(source, tokens, "%", 0).classes).toContain("modifier");
    expect(tokenAt(source, tokens, "%", 1).classes).toContain("operator");
    expect(tokenAt(source, tokens, "!", 0).classes).toContain("modifier");
    expect(tokenAt(source, tokens, "!", 1).classes).toContain("operator");
    expect(tokenAt(source, tokens, "!=").classes).toContain("operator");
  });

  it("keeps built-in names available as user declaration identifiers", () => {
    const source = `module cube() {}
function sin(value) = value;
module echo() {}
function assert(value) = value;
module cubeish() {}`;
    const tree = parseOpenScad(source);
    const tokens = classify(source);

    expect(tree.toString()).not.toContain("⚠");
    expect(tokenAt(source, tokens, "cube").classes).toContain("user-module");
    expect(tokenAt(source, tokens, "sin").classes).toContain("user-module");
    expect(tokenAt(source, tokens, "echo").classes).toContain("user-module");
    expect(tokenAt(source, tokens, "assert").classes).toContain("user-module");
    expect(tokenAt(source, tokens, "cubeish").classes).toContain("user-module");
  });

  it("classifies the complete provisional 2021.01 built-in corpus", () => {
    const moduleSource = OPENSCAD_BUILTIN_MODULES.map((name) => `${name}();`).join("\n");
    const functionSource = OPENSCAD_BUILTIN_FUNCTIONS.map(
      (name, index) =>
        name === "echo" ? `result_${index} = echo() undef;` : `result_${index} = ${name}();`,
    ).join("\n");
    const source = `${moduleSource}\n${functionSource}`;
    const tree = parseOpenScad(source);
    const tokens = classify(source);

    expect(OPENSCAD_BUILTIN_REFERENCE).toBe("openscad-2021.01-official-reference");
    expect(tree.toString()).not.toContain("⚠");
    for (const name of new Set([...OPENSCAD_BUILTIN_MODULES, ...OPENSCAD_BUILTIN_FUNCTIONS])) {
      expect(tokenAt(source, tokens, name).classes, name).toContain("builtin");
    }
  });

  it("parses and classifies every provisional keyword and documented special variable", () => {
    const source = `use <library.scad>
$fa = 1; $fs = 2; $fn = 3; $t = 0.5;
$vpr = [0, 0, 0]; $vpt = [0, 0, 0]; $vpd = 10; $vpf = 20;
$children = 1; $preview = false; $custom = 7;
for (item = [0:1]) cube(item);
intersection_for (item = [0:1]) sphere(item);
let (size = 2) cube(size);
values = [for (item = [0:1]) item];
flat = [each [1, 2]];`;
    const tree = parseOpenScad(source);
    const tokens = classify(source);

    expect(tree.toString()).not.toContain("⚠");
    for (const keyword of ["use", "for", "intersection_for", "let", "each"]) {
      expect(tokenAt(source, tokens, keyword).classes, keyword).toContain("keyword");
    }
    for (const variable of [
      "$fa",
      "$fs",
      "$fn",
      "$t",
      "$vpr",
      "$vpt",
      "$vpd",
      "$vpf",
      "$children",
      "$preview",
      "$custom",
    ]) {
      expect(tokenAt(source, tokens, variable).classes, variable).toContain("special-variable");
    }
  });

  it("handles numeric forms, escaped strings, and comment/division boundaries", () => {
    const source = `a = 0; b = 12; c = 0.5; d = .25; e = 1.; f = 6.02e23; g = 1e-3;
text_value = "quote: \\" and slash: \\\\";
quotient = 8 / 2; /**/ /***/ /* ** x */ // trailing`;
    const tree = parseOpenScad(source);
    const tokens = classify(source);

    expect(tree.toString()).not.toContain("⚠");
    for (const number of ["0", "12", "0.5", ".25", "1.", "6.02e23", "1e-3"]) {
      expect(tokenAt(source, tokens, number).classes, number).toContain("number");
    }
    expect(tokenAt(source, tokens, "/").classes).toContain("operator");
    for (const comment of ["/**/", "/***/", "/* ** x */", "// trailing"]) {
      expect(tokenAt(source, tokens, comment).classes, comment).toContain("comment");
    }
  });

  it("parses the OpenSCAD 2021.01 expression forms without recovery", () => {
    const source = `function with_let(value) = let (derived = value) derived;
function with_assert(value) = assert(value > 0) value;
function with_echo(value) = echo(value) value;
square_fn = function (value) value * value;
selector = function (which) which == "add"
    ? function (value) value + value
    : function (value) value * value;
result = selector("add")(5);`;

    expect(parseOpenScad(source).toString()).not.toContain("⚠");
  });

  it("parses recursive, filtered, flattened, mixed, and C-style comprehensions", () => {
    const source = `nested = [for (i = [0:1]) for (j = [0:1]) i + j];
filtered = [for (i = [0:3]) if (i % 2 == 0) i];
flat = [for (row = [[1, 2]]) each row];
mixed = [0, for (i = [1:3]) i, each [5, 6], 7];
local = [for (a = [1:4]) let (b = a * a) b];
branches = [for (a = [-1:1]) if (a < 0) -a else a];
c_style = [for (a = 0, b = 1; a < 10; next = a + b, a = b, b = next) a];`;

    expect(parseOpenScad(source).toString()).not.toContain("⚠");
  });
});
