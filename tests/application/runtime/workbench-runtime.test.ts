import { describe, expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess3D } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

function successfulEngine(): EngineService {
  const result: RenderSuccess3D = {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: new Uint8Array(684) },
    stats: {
      triangles: 12,
      boundingBox: { min: [0, 0, 0], max: [10, 20, 30] },
      engineTimeMs: 8,
    },
    diagnostics: [],
    rawLog: "rendered",
  };
  return {
    render: vi.fn().mockReturnValue({ jobId: "render-1", done: Promise.resolve(result) }),
    export: vi.fn(),
    version: vi.fn().mockResolvedValue({ version: "2021.01", path: "native", features: [] }),
    cancel: vi.fn(),
  };
}

describe("createWorkbenchRuntime", () => {
  it("routes edits and renders through one command history", async () => {
    const engine = successfulEngine();
    const runtime = createWorkbenchRuntime(engine, {
      makeId: (() => {
        let next = 0;
        return () => `command-${++next}`;
      })(),
      now: () => new Date("2026-07-10T04:00:00.000Z"),
    });

    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      source: "cube([10, 20, 30]);",
    });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(runtime.documents.getState()).toEqual({
      path: "main.scad",
      source: "cube([10, 20, 30]);",
      dirty: true,
    });
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      jobId: "render-1",
      quality: "preview",
      result: { kind: "3d", stats: { triangles: 12 } },
    });
    expect(engine.render).toHaveBeenCalledWith({
      entryFile: "main.scad",
      files: new Map([["main.scad", "cube([10, 20, 30]);"]]),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    });
    expect(runtime.history.getState()).toEqual([
      {
        commandId: "command-1",
        timestamp: "2026-07-10T04:00:00.000Z",
        origin: "user",
        kind: "edit-document",
        summary: "Edit main.scad",
        undoable: true,
      },
      {
        commandId: "command-2",
        timestamp: "2026-07-10T04:00:00.000Z",
        origin: "user",
        kind: "render-active",
        summary: "Render main.scad at preview quality",
        undoable: false,
      },
    ]);
  });

  it("records one command for a real theme change and ignores a no-op selection", async () => {
    const engine = successfulEngine();
    const runtime = createWorkbenchRuntime(engine, {
      makeId: () => "theme-command",
      now: () => new Date("2026-07-10T06:30:00.000Z"),
    });

    expect(runtime.settings.getState()).toEqual({ theme: "system" });

    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "high-contrast" });
    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "high-contrast" });

    expect(runtime.settings.getState()).toEqual({ theme: "high-contrast" });
    expect(runtime.history.getState()).toEqual([
      {
        commandId: "theme-command",
        timestamp: "2026-07-10T06:30:00.000Z",
        origin: "user",
        kind: "set-theme",
        summary: "Switch theme to High contrast",
        undoable: false,
      },
    ]);
    expect(engine.render).not.toHaveBeenCalled();
  });
});
