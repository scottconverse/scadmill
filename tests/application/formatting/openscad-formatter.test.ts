import { describe, expect, it } from "vitest";

import { formatOpenScad } from "../../../src/ui/editor/openscad-formatter";

interface GoldenFixture {
  readonly id: string;
  readonly input: string;
  readonly expected: string;
}

const lines = (...source: readonly string[]) => source.join("\n");

function seededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function fixtureSeed(id: string) {
  let hash = 2_166_136_261;

  for (const character of id) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function seededWhitespaceMutations(source: string, seed: number, count: number) {
  const protectedSegments: string[] = [];
  const masked = source.replace(
    /"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu,
    (segment) => {
      const placeholder = `__SCADMILL_PROTECTED_${protectedSegments.length}__`;
      protectedSegments.push(segment);
      return placeholder;
    },
  );
  const random = seededRandom(seed);
  const spaces = (minimum = 0) =>
    " ".repeat(minimum + Math.floor(random() * (5 - minimum)));
  const mutations = new Set<string>();

  for (let attempt = 0; mutations.size < count && attempt < 128; attempt += 1) {
    const mutated = masked
      .replace(/[ \t]*([=+*])[ \t]*/gu, (_match, operator: string) =>
        `${spaces()}${operator}${spaces()}`,
      )
      .replace(/[ \t]*,[ \t]*/gu, () => `${spaces()},${spaces()}`)
      .replace(/[ \t]*(?=\{)/gu, () => spaces())
      .replace(/\b(include|use)[ \t]*(?=<)/gu, (_match, keyword: string) =>
        `${keyword}${spaces(1)}`,
      )
      .replace(/([#!])[ \t]*/gu, (_match, modifier: string) => `${modifier}${spaces()}`)
      .replace(/__SCADMILL_PROTECTED_(\d+)__/gu, (_match, index: string) =>
        protectedSegments[Number(index)] ?? "",
      );

    if (mutated !== source) {
      mutations.add(mutated);
    }
  }

  return [...mutations];
}

const FIXTURES: readonly GoldenFixture[] = [
  {
    id: "E1 operator and comma spacing",
    input: "x=1+2*(3-4);v=[1,2 ,3];",
    expected: lines("x = 1 + 2 * (3 - 4);", "v = [1, 2, 3];"),
  },
  {
    id: "E2 indentation normalization",
    input: lines("module a(){", "      cube(1);", "  sphere(2);", "}"),
    expected: lines("module a() {", "    cube(1);", "    sphere(2);", "}"),
  },
  {
    id: "E3 attached braces",
    input: lines("module b()", "{", "    cube(1);", "}"),
    expected: lines("module b() {", "    cube(1);", "}"),
  },
  {
    id: "E4 one statement per line",
    input: "cube(1); sphere(2); cylinder(h = 3, r = 1);",
    expected: lines("cube(1);", "sphere(2);", "cylinder(h = 3, r = 1);"),
  },
  {
    id: "E5 blank-line collapse",
    input: lines("a = 1;", "", "", "", "b = 2;"),
    expected: lines("a = 1;", "", "b = 2;"),
  },
  {
    id: "E6 customizer annotations",
    input: lines(
      "/* [Dimensions] */",
      "width=40; // [10:100]",
      'style="round"; // [round:Rounded, square:Square]',
      "/* [Hidden] */",
      "eps=0.01;",
    ),
    expected: lines(
      "/* [Dimensions] */",
      "width = 40; // [10:100]",
      'style = "round"; // [round:Rounded, square:Square]',
      "/* [Hidden] */",
      "eps = 0.01;",
    ),
  },
  {
    id: "E7 transform chain",
    input: "translate([0,0,5]) rotate([0,90,0]) cylinder(h=10,r=2);",
    expected: lines(
      "translate([0, 0, 5])",
      "    rotate([0, 90, 0])",
      "    cylinder(h = 10, r = 2);",
    ),
  },
  {
    id: "E8 single transform inline",
    input: "translate([0,0,5])cube(10);",
    expected: "translate([0, 0, 5]) cube(10);",
  },
  {
    id: "E9 list comprehension",
    input: "pts=[for(i=[0:10])[i,i*i]];",
    expected: "pts = [for (i = [0:10]) [i, i * i]];",
  },
  {
    id: "E10 let and ternary",
    input: "r=let(a=2,b=3)a>b?a:b;",
    expected: "r = let (a = 2, b = 3) a > b ? a : b;",
  },
  {
    id: "E11 modifier characters",
    input: lines("#  cube(5);", "!translate([1,0,0]) sphere(2);"),
    expected: lines("#cube(5);", "!translate([1, 0, 0]) sphere(2);"),
  },
  {
    id: "E12 include and use",
    input: lines("include <BOSL2/std.scad>", "use   <lib/gears.scad>"),
    expected: lines("include <BOSL2/std.scad>", "use <lib/gears.scad>"),
  },
  {
    id: "E13 functions and long expression",
    input: lines(
      "function vol(w,d,h)=w*d*h;",
      "function big(a,b,c,d,e,f)=a*b*c+a*b*d+a*b*e+a*b*f+c*d*e+c*d*f+really_long_name(a,b)+another_long_name(c,d);",
    ),
    expected: lines(
      "function vol(w, d, h) = w * d * h;",
      "function big(a, b, c, d, e, f) = a * b * c + a * b * d + a * b * e + a * b * f +",
      "    c * d * e + c * d * f + really_long_name(a, b) + another_long_name(c, d);",
    ),
  },
  {
    id: "E14 nested vectors",
    input: "m = [ [1 ,0 ,0], [0,1, 0],[0,0,1] ];",
    expected: "m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];",
  },
  {
    id: "E15 comment positions",
    input: lines("a=1;// answer", "/* block", "   comment */", "b=2;"),
    expected: lines("a = 1; // answer", "/* block", "   comment */", "b = 2;"),
  },
] as const;

describe("OpenSCAD formatter Appendix E goldens", () => {
  for (const fixture of FIXTURES) {
    it(`formats ${fixture.id} exactly and idempotently`, () => {
      const formatted = formatOpenScad(fixture.input, { indentSize: 4 });
      expect(formatted).toEqual({ status: "formatted", source: fixture.expected });
      expect(formatOpenScad(fixture.expected, { indentSize: 4 })).toEqual(formatted);
    });
  }

  it("refuses syntax errors without changing a byte", () => {
    const source = "module broken( { cube(1);";

    expect(formatOpenScad(source, { indentSize: 4 })).toEqual({
      status: "refused",
      reason: "syntax-error",
      source,
    });
  });

  it("normalizes a seeded fuzzed mutation set back to the same goldens", () => {
    for (const fixture of FIXTURES) {
      const mutations = seededWhitespaceMutations(fixture.expected, fixtureSeed(fixture.id), 4);

      expect(mutations, `${fixture.id} mutation diversity`).toHaveLength(4);
      for (const mutation of mutations) {
        const formatted = formatOpenScad(mutation, { indentSize: 4 });
        expect(formatted).toEqual({ status: "formatted", source: fixture.expected });
        expect(formatOpenScad(formatted.source, { indentSize: 4 })).toEqual(formatted);
      }
    }
  });

  it("never wraps operator-like text inside strings or comments", () => {
    const literal = "a long label + with operator text + that remains one exact string value";
    const source = `label="${literal}"; // trailing + comment text + is also preserved exactly`;

    expect(formatOpenScad(source, { indentSize: 4 })).toEqual({
      status: "formatted",
      source: `label = "${literal}"; // trailing + comment text + is also preserved exactly`,
    });
  });
});
