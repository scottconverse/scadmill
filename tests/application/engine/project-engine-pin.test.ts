import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { projectEnginePin } from "../../../src/application/engine/project-engine-pin";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

describe("project engine pin", () => {
  it("parses only the exact bounded project manifest shape", () => {
    const pinned = createProjectSnapshot("project", new Map([
      ["main.scad", "cube(10);"],
      ["scadmill.project.json", "{\"schemaVersion\":1,\"engineVersion\":\"2026.06.12\"}"],
    ]));
    expect(projectEnginePin(pinned)).toBe("2026.06.12");
    expect(projectEnginePin(createProjectSnapshot("project", new Map([
      ["main.scad", "cube(10);"],
    ])))).toBeUndefined();
    expect(() => projectEnginePin(createProjectSnapshot("project", new Map([
      ["main.scad", "cube(10);"],
      ["scadmill.project.json", "{\"schemaVersion\":1,\"engineVersion\":\"X\",\"extra\":true}"],
    ])))).toThrow(/manifest/i);
  });

  it("renders with project version X even when the default engine reports Y", async () => {
    const engine: EngineService = {
      render: vi.fn(() => ({
        jobId: "pinned-render",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve({
          kind: "3d" as const,
          mesh: { format: "stl-binary" as const, bytes: new Uint8Array(84) },
          stats: { engineTimeMs: 1 }, diagnostics: [], rawLog: "",
        }),
      })),
      export: vi.fn(),
      version: vi.fn(async (requiredVersion) => ({
        version: requiredVersion ?? "Y",
        path: "native" as const,
        features: [],
        buildIdentity: `native:${requiredVersion ?? "Y"}`,
      })),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    await runtime.dispatch({
      kind: "replace-project-confirmed",
      origin: "user",
      snapshot: createProjectSnapshot("project", new Map([
        ["main.scad", "cube(10);"],
        ["scadmill.project.json", "{\"schemaVersion\":1,\"engineVersion\":\"X\"}"],
      ])),
      displayName: "Pinned",
      entryFile: "main.scad",
    });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(engine.version).toHaveBeenCalledWith("X");
    expect(engine.render).toHaveBeenCalledWith(expect.objectContaining({ engineVersion: "X" }));
    runtime.dispose();
  });

  it("pins an installed version by writing the strict project manifest", async () => {
    let snapshot = createProjectSnapshot("project", new Map([["main.scad", "cube(10);"]]));
    const storage = {
      snapshot: vi.fn(async () => snapshot),
      write: vi.fn(async (_projectId: string, path: string, content: string | Uint8Array) => {
        const files = new Map(snapshot.files);
        files.set(path as never, content);
        snapshot = createProjectSnapshot("project", files);
      }),
      move: vi.fn(), trash: vi.fn(), reveal: vi.fn(),
    };
    const engine: EngineService = {
      render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { projectStorage: storage });
    await runtime.dispatch({
      kind: "replace-project-confirmed", origin: "user", snapshot,
      displayName: "Pinned", entryFile: "main.scad",
    });

    await runtime.dispatch({ kind: "pin-project-engine", origin: "user", engineVersion: "X" });

    expect(storage.write).toHaveBeenCalledWith("project", "scadmill.project.json", [
      "{", '  "schemaVersion": 1,', '  "engineVersion": "X"', "}", "",
    ].join("\n"));
    expect(projectEnginePin(runtime.project.getState().snapshot)).toBe("X");
    runtime.dispose();
  });
});
