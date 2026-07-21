import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import { createProjectSnapshot, type ProjectFileContent } from "../../../src/application/files/project-snapshot";
import {
  createOpenScadLibraryManager,
  WELL_KNOWN_OPENSCAD_LIBRARIES,
} from "../../../src/application/libraries/library-manager";

const BOSL2 = WELL_KNOWN_OPENSCAD_LIBRARIES[0];
if (!BOSL2) throw new Error("The BOSL2 catalog fixture is missing.");

function archive(root: string, version = "1.0.0"): Uint8Array {
  return zipSync({
    [`${root}/LICENSE`]: strToU8("BSD 2-Clause License\nPermission is hereby granted."),
    [`${root}/std.scad`]: strToU8(`// Größenmaß\nmodule library_part(size = ${version.length}) { cube(size); }`),
    [`${root}/nested/helpers.scad`]: strToU8("function library_value(scale = 1) = scale * 2;"),
    [`${root}/resources/preview.png`]: new Uint8Array([137, 80, 78, 71]),
    [`${root}/examples/demo.scad`]: strToU8("module example_only() {}"),
    [`${root}/docs/guide.html`]: strToU8("not required at render time"),
  });
}

function memoryStorage(initial = new Map<string, ProjectFileContent>()) {
  const files = new Map(initial);
  const storage: ProjectStorage = {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    read: async (_projectId, path) => files.get(path),
    write: vi.fn(async (_projectId, path, content) => {
      files.set(path, typeof content === "string" ? content : content.slice());
    }),
    move: vi.fn(),
    trash: vi.fn(async (_projectId, path) => {
      if (!files.delete(path)) throw new Error(`missing ${path}`);
    }),
    reveal: vi.fn(),
  };
  return { files, storage };
}

describe("OpenSCAD library manager", () => {
  it("ships pinned BOSL2, MCAD, and dotSCAD catalog entries", () => {
    expect(WELL_KNOWN_OPENSCAD_LIBRARIES.map(({ id }) => id)).toEqual([
      "bosl2",
      "mcad",
      "dotscad",
    ]);
    for (const entry of WELL_KNOWN_OPENSCAD_LIBRARIES) {
      expect(entry.version).toMatch(/\d/);
      expect(entry.archiveUrl).not.toMatch(/\/(?:main|master)\.zip$/);
      expect(entry.license.spdxId).toBeTruthy();
    }
    expect(WELL_KNOWN_OPENSCAD_LIBRARIES[1]?.license).toMatchObject({
      spdxId: "LGPL-2.1-only",
      url: expect.stringContaining("lgpl-2.1.txt"),
    });
  });

  it("prepares a safe runtime vendor copy and exposes the actual license before install", async () => {
    const { storage } = memoryStorage();
    const manager = createOpenScadLibraryManager({
      projectId: "fixture",
      storage,
      download: vi.fn(async () => archive("BOSL2-2.0.747")),
    });

    const prepared = await manager.prepare(BOSL2);

    expect(prepared.licenseText).toContain("BSD 2-Clause License");
    expect(prepared.files.get("BOSL2/std.scad")).toContain("Größenmaß");
    expect([...prepared.files.keys()]).toEqual(expect.arrayContaining([
      "BOSL2/LICENSE",
      "BOSL2/nested/helpers.scad",
      "BOSL2/resources/preview.png",
      "BOSL2/std.scad",
    ]));
    expect([...prepared.files.keys()]).not.toContain("BOSL2/docs/guide.html");
    expect([...prepared.files.keys()]).not.toContain("BOSL2/examples/demo.scad");
  });

  it("uses the CORS-safe pinned GitHub inventory path for catalog installs", async () => {
    const { storage } = memoryStorage();
    const license = strToU8("BSD 2-Clause License");
    const source = strToU8("module cuboid(size = 1) { cube(size); }");
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.github.com")) {
        return new Response(JSON.stringify({
          truncated: false,
          tree: [
            { path: "LICENSE", type: "blob", size: license.byteLength },
            { path: "std.scad", type: "blob", size: source.byteLength },
            { path: "docs/guide.html", type: "blob", size: 20 },
          ],
        }));
      }
      if (url.endsWith("/LICENSE")) return new Response(license);
      if (url.endsWith("/std.scad")) return new Response(source);
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", request);
    try {
      const manager = createOpenScadLibraryManager({ projectId: "fixture", storage });
      const prepared = await manager.prepare(BOSL2);

      expect(prepared.files.get("BOSL2/std.scad")).toContain("module cuboid");
      expect(request.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
        expect.stringContaining("api.github.com/repos/BelfrySCAD/BOSL2/git/trees/v2.0.747"),
        expect.stringContaining("raw.githubusercontent.com/BelfrySCAD/BOSL2/v2.0.747/std.scad"),
      ]));
      expect(request.mock.calls.map(([url]) => String(url)).join("\n")).not.toContain("codeload");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("installs files and a pinned manifest, then removes only owned files", async () => {
    const { files, storage } = memoryStorage(new Map([["main.scad", "include <BOSL2/std.scad>"]]));
    const manager = createOpenScadLibraryManager({
      projectId: "fixture",
      storage,
      download: async () => archive("BOSL2-2.0.747"),
    });
    const prepared = await manager.prepare(BOSL2);

    const installed = await manager.install(prepared);

    expect(installed).toMatchObject({ id: "bosl2", version: "v2.0.747" });
    expect(files.get("BOSL2/std.scad")).toContain("module library_part");
    expect(files.get("BOSL2/LICENSE")).toContain("BSD 2-Clause License");
    expect(JSON.parse(files.get("scadmill.libraries.json") as string)).toMatchObject({
      schemaVersion: 1,
      libraries: [{ id: "bosl2", version: "v2.0.747" }],
    });

    await manager.remove("bosl2");

    expect(files.has("BOSL2/std.scad")).toBe(false);
    expect(files.has("BOSL2/LICENSE")).toBe(false);
    expect(files.get("main.scad")).toBe("include <BOSL2/std.scad>");
    expect(JSON.parse(files.get("scadmill.libraries.json") as string)).toEqual({
      schemaVersion: 1,
      libraries: [],
    });
  });

  it("requires an explicit re-pin and removes stale files when updating", async () => {
    const { files, storage } = memoryStorage();
    const first = createOpenScadLibraryManager({
      projectId: "fixture",
      storage,
      download: async () => archive("BOSL2-old", "old"),
    });
    const oldPackage = await first.prepare({
      ...BOSL2,
      version: "v2.0.746",
    });
    await first.install(oldPackage);

    const nextPackage = await first.prepare(BOSL2);
    await expect(first.install(nextPackage)).rejects.toThrow("explicit re-pin");
    await first.install(nextPackage, { repin: true });

    const manifest = JSON.parse(files.get("scadmill.libraries.json") as string);
    expect(manifest.libraries).toEqual([
      expect.objectContaining({ id: "bosl2", version: "v2.0.747" }),
    ]);
  });

  it("rolls back every touched file when a multi-file install fails", async () => {
    const { files, storage } = memoryStorage(new Map([["main.scad", "cube(1);"]]));
    let packageBytes = archive("BOSL2-old", "old");
    const manager = createOpenScadLibraryManager({
      projectId: "fixture",
      storage,
      download: async () => packageBytes,
    });
    await manager.install(await manager.prepare({
      ...BOSL2,
      version: "v2.0.746",
    }));
    const oldSource = files.get("BOSL2/std.scad");
    packageBytes = archive("BOSL2-new", "new-version");
    let writeCount = 0;
    storage.write = vi.fn(async (_projectId, path, content) => {
      writeCount += 1;
      if (writeCount === 3) throw new Error("disk full");
      files.set(path, content);
    });

    await expect(manager.install(
      await manager.prepare(BOSL2),
      { repin: true },
    )).rejects.toThrow("disk full");

    expect(files.get("BOSL2/std.scad")).toBe(oldSource);
    expect(files.has("BOSL2/LICENSE")).toBe(true);
    expect(files.has("BOSL2/resources/preview.png")).toBe(true);
    expect(JSON.parse(files.get("scadmill.libraries.json") as string).libraries[0].version)
      .toBe("v2.0.746");
  });

  it("rejects unsafe archive paths and packages without a license", async () => {
    const { storage } = memoryStorage();
    const descriptor = BOSL2;
    const unsafe = createOpenScadLibraryManager({
      projectId: "fixture",
      storage,
      download: async () => zipSync({
        "package/LICENSE": strToU8("license"),
        "package/../escape.scad": strToU8("cube(1);"),
      }),
    });
    await expect(unsafe.prepare(descriptor)).rejects.toThrow(/safe|escape|path/i);

    const unlicensed = createOpenScadLibraryManager({
      projectId: "fixture",
      storage,
      download: async () => zipSync({ "package/std.scad": strToU8("cube(1);") }),
    });
    await expect(unlicensed.prepare(descriptor)).rejects.toThrow(/license/i);
  });
});
