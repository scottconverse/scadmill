import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import { createProjectSnapshot, type ProjectFileContent } from "../../../src/application/files/project-snapshot";
import {
  createOpenScadLibraryManager,
  WELL_KNOWN_OPENSCAD_LIBRARIES,
} from "../../../src/application/libraries/library-manager";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { createOpenScadCompletionSource } from "../../../src/ui/editor/openscad-completion";
import { openScad } from "../../../src/ui/editor/openscad-language";

const BOSL2 = WELL_KNOWN_OPENSCAD_LIBRARIES[0];
if (!BOSL2) throw new Error("The BOSL2 catalog fixture is missing.");

function fixture() {
  const files = new Map<string, ProjectFileContent>([[
    "main.scad",
    "include <BOSL2/std.scad>\ncuboid([10, 20, 30]);",
  ]]);
  const storage: ProjectStorage = {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    read: async (_projectId, path) => files.get(path),
    write: async (_projectId, path, content) => { files.set(path, content); },
    move: vi.fn(),
    trash: async (_projectId, path) => { files.delete(path); },
    reveal: vi.fn(),
  };
  const archive = zipSync({
    "BOSL2-2.0.747/LICENSE": strToU8("BSD 2-Clause License"),
    "BOSL2-2.0.747/std.scad": strToU8(
      "module cuboid(size = [1, 1, 1], rounding = 0, anchor = CENTER) { cube(size); }",
    ),
  });
  const manager = createOpenScadLibraryManager({
    projectId: "fixture",
    storage,
    download: async () => archive,
  });
  return { files, manager, storage };
}

function engine(jobId: string): EngineService {
  return {
    render: vi.fn().mockReturnValue({
      jobId,
      done: Promise.resolve({
        kind: "3d",
        mesh: { format: "stl-binary", bytes: new Uint8Array() },
        stats: { engineTimeMs: 1 },
        diagnostics: [],
        rawLog: "",
      }),
    }),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
}

describe("installed library runtime integration", () => {
  it.each(["native", "wasm"])(
    "passes the same vendored BOSL2 include tree to the %s engine path",
    async (enginePath) => {
      const { manager, storage } = fixture();
      await manager.install(await manager.prepare(BOSL2));
      const service = engine(enginePath);
      const runtime = createWorkbenchRuntime(service, {
        initialProject: await storage.snapshot("fixture"),
        renderCache: null,
      });

      await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

      expect(service.render).toHaveBeenCalledWith(expect.objectContaining({
        entryFile: "main.scad",
        files: expect.any(Map),
      }));
      const request = vi.mocked(service.render).mock.calls[0]?.[0];
      expect(request?.files.get("BOSL2/std.scad")).toContain("module cuboid");
      expect(request?.files.get("BOSL2/LICENSE")).toBe("BSD 2-Clause License");
    },
  );

  it("offers an installed BOSL2 signature and removes it when the library is removed", async () => {
    const { manager, storage } = fixture();
    await manager.install(await manager.prepare(BOSL2));
    const document = "include <BOSL2/std.scad>\ncub";
    const completionLabels = async () => {
      const snapshot = await storage.snapshot("fixture");
      const sources = new Map<string, string>();
      for (const [path, content] of snapshot.files) {
        if (typeof content === "string") sources.set(path, content);
      }
      const source = createOpenScadCompletionSource(() => ({
        documentPath: "main.scad",
        sources,
      }));
      const state = EditorState.create({ doc: document, extensions: [openScad()] });
      const result = await source(new CompletionContext(state, state.doc.length, false));
      source.dispose();
      return result?.options ?? [];
    };

    expect(await completionLabels()).toContainEqual(expect.objectContaining({
      label: "cuboid",
      detail: "cuboid(size = [1, 1, 1], rounding = 0, anchor = CENTER)",
    }));

    await manager.remove("bosl2");

    expect((await completionLabels()).map(({ label }) => label)).not.toContain("cuboid");
  });
});
