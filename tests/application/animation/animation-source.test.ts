import { describe, expect, it } from "vitest";

import { projectUsesAnimationTime, usesAnimationTime } from "../../../src/application/animation/animation-source";

describe("usesAnimationTime", () => {
  it("finds the standalone OpenSCAD animation variable in executable source", () => {
    expect(usesAnimationTime("rotate([0, 0, 360 * $t]) cube(10);")) .toBe(true);
    expect(usesAnimationTime("value = $time; cube(value);")) .toBe(false);
    expect(usesAnimationTime("value = thing$t; cube(value);")) .toBe(false);
  });

  it("ignores animation-looking text inside comments and strings", () => {
    expect(usesAnimationTime(`
      // rotate([0, 0, 360 * $t]) cube(10);
      echo("$t is documented here");
      /* sphere(10 + $t); */
      cube(10);
    `)).toBe(false);
  });

  it("continues correctly after escaped strings and terminated block comments", () => {
    expect(usesAnimationTime('echo("quoted \\"$t\\""); /* $t */ rotate($t * 90) cube(1);')).toBe(true);
  });
});

describe("projectUsesAnimationTime", () => {
  it("follows reachable include and use dependencies with open-buffer file contents", () => {
    const files = new Map<string, string>([
      ["main.scad", "include <lib/animated.scad>\nanimated();"],
      ["lib/animated.scad", "module animated() { rotate($t * 360) cube(1); }"],
      ["unrelated.scad", "sphere(5 + $t);"],
    ]);

    expect(projectUsesAnimationTime("main.scad", files)).toBe(true);
    expect(projectUsesAnimationTime("plain.scad", new Map([
      ["plain.scad", "cube(1);"],
      ["unrelated.scad", "sphere(5 + $t);"],
    ]))).toBe(false);
  });

  it("ignores commented dependencies and terminates include cycles", () => {
    const files = new Map<string, string>([
      ["main.scad", "// include <animated.scad>\ninclude <cycle.scad>\ncube(1);"],
      ["cycle.scad", "use <main.scad>"],
      ["animated.scad", "cube($t);"],
    ]);

    expect(projectUsesAnimationTime("main.scad", files)).toBe(false);
  });
});
