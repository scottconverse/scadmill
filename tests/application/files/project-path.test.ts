import { describe, expect, it } from "vitest";
import {
  ProjectPathError,
  parseProjectPath,
  validateProjectLayout,
} from "../../../src/application/files/project-path";

describe("portable project paths", () => {
  it("accepts normalized project-relative paths used by OpenSCAD projects", () => {
    expect(parseProjectPath("part sets/v1.2/body-model_01.scad")).toBe(
      "part sets/v1.2/body-model_01.scad",
    );
    expect(parseProjectPath("parts/.hidden.scad")).toBe("parts/.hidden.scad");
    expect(parseProjectPath("parts/COM10.scad")).toBe("parts/COM10.scad");
  });

  it.each([
    "",
    "/absolute.scad",
    "C:/absolute.scad",
    "../escape.scad",
    "parts/../escape.scad",
    "parts/./body.scad",
    "parts//body.scad",
    "parts\\body.scad",
    "parts/body.scad\0hidden",
    "parts/body.scad:metadata",
    "parts./body.scad",
    "parts /body.scad",
    "parts/body.scad.",
    "parts/body.scad ",
    "NUL.scad",
    "parts/con",
    "parts/CoM1.profile",
    "parts/LPT9.txt",
    "parts/COM¹.log",
    "parts/CONIN$.txt",
  ])("rejects unsafe or nonportable path %j", (candidate) => {
    expect(() => parseProjectPath(candidate)).toThrow(ProjectPathError);
  });

  it("rejects case aliases and file-directory collisions", () => {
    expect(() => validateProjectLayout(["parts/body.scad", "PARTS/BODY.scad"])).toThrow(
      /collide/i,
    );
    expect(() => validateProjectLayout(["parts", "parts/body.scad"])).toThrow(
      /parent directory/i,
    );
  });
});
