import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import {
  ProjectZipError,
  decodeProjectZip,
  encodeProjectZip,
} from "../../../src/application/files/project-zip";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";

describe("project ZIP interchange", () => {
  it("round-trips nested text and binary project files byte-identically", () => {
    const original = createProjectSnapshot("source-project", new Map<string, ProjectFileContent>([
      ["main.scad", "include <parts/rim.scad>\ncube(10);\n"],
      ["parts/rim.scad", "difference() { circle(10); circle(8); }\n"],
      ["assets/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255])],
    ]));

    const archive = encodeProjectZip(original);
    const decoded = decodeProjectZip("imported-project", archive);

    expect(decoded.projectId).toBe("imported-project");
    expect(decoded.files.get("main.scad" as never)).toBe(original.files.get("main.scad" as never));
    expect(decoded.files.get("parts/rim.scad" as never)).toBe(original.files.get("parts/rim.scad" as never));
    expect(decoded.files.get("assets/logo.png" as never)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]));
  });

  it("round-trips paths that match object prototype property names", () => {
    const original = createProjectSnapshot("prototype-paths", new Map<string, ProjectFileContent>([
      ["__proto__", "cube(1);"],
      ["constructor", new Uint8Array([0, 1, 2, 255])],
      ["toString", "sphere(2);"],
    ]));

    const decoded = decodeProjectZip("imported", encodeProjectZip(original));

    expect(decoded.files.get("__proto__" as never)).toBe("cube(1);");
    expect(decoded.files.get("constructor" as never)).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(decoded.files.get("toString" as never)).toBe("sphere(2);");
  });

  it("accepts harmless explicit directory records added by ZIP tools", () => {
    const archive = zipSync({
      "parts/": new Uint8Array(),
      "parts/main.scad": strToU8("cube(3);"),
      ".scadmill-project-v1.json": strToU8(JSON.stringify({
        version: 1,
        textPaths: ["parts/main.scad"],
      })),
    });

    const decoded = decodeProjectZip("rezipped", archive);

    expect(decoded.files.get("parts/main.scad" as never)).toBe("cube(3);");
    expect(decoded.files).toHaveLength(1);
  });

  it("rejects path traversal, missing manifests, and decompressed-size overages", () => {
    const traversal = zipSync({
      ".scadmill-project-v1.json": strToU8(JSON.stringify({ version: 1, textPaths: ["../escape.scad"] })),
      "../escape.scad": strToU8("cube(1);"),
    });
    const noManifest = zipSync({ "main.scad": strToU8("cube(1);") });
    const large = encodeProjectZip(createProjectSnapshot("large", new Map([
      ["main.scad", "cube(1);".repeat(1_000)],
    ])));

    expect(() => decodeProjectZip("target", traversal)).toThrow(/path|invalid/u);
    expect(() => decodeProjectZip("target", noManifest)).toThrow(/manifest/u);
    expect(() => decodeProjectZip("target", large, { decompressedByteLimit: 100 })).toThrow(/large/u);
  });

  it("rejects the reserved manifest path in user content", () => {
    const snapshot = createProjectSnapshot("project", new Map([
      [".scadmill-project-v1.json", "user data"],
    ]));
    expect(() => encodeProjectZip(snapshot)).toThrow(ProjectZipError);
  });
});
