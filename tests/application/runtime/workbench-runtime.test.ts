import { describe, expect, it, vi } from "vitest";

import type {
  EngineService,
  RenderFailure,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
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
      documentId: "document-main",
      source: "cube([10, 20, 30]);",
    });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(runtime.documents.getState()).toMatchObject({
      activeDocumentId: "document-main",
      documents: [{
        id: "document-main",
        path: "main.scad",
        source: "cube([10, 20, 30]);",
        revision: 1,
        savedRevision: 0,
      }],
    });
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      jobId: "render-1",
      quality: "preview",
      documentId: "document-main",
      entryFile: "main.scad",
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

  it("routes real tab lifecycle mutations once and ignores blocked or stale operations", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), {
      makeId: (() => {
        let next = 0;
        return () => `tab-command-${++next}`;
      })(),
      now: () => new Date("2026-07-10T05:00:00.000Z"),
    });

    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({
      kind: "move-document",
      origin: "user",
      documentId: "document-wheel",
      toIndex: 0,
    });
    await runtime.dispatch({
      kind: "close-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({ kind: "reopen-document", origin: "user" });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "ai-panel",
      documentId: "document-wheel",
      source: "cylinder(r = 5, h = 2);",
    });
    await runtime.dispatch({
      kind: "close-document",
      origin: "user",
      documentId: "document-wheel",
    });

    expect(runtime.documents.getState()).toMatchObject({
      activeDocumentId: "document-main",
      documents: [
        { id: "document-wheel", source: "cylinder(r = 5, h = 2);", revision: 1 },
        { id: "document-main", source: "cube(10);", revision: 0 },
      ],
      recentlyClosed: [],
    });
    expect(runtime.history.getState().map(({ kind, origin }) => ({ kind, origin }))).toEqual([
      { kind: "open-document", origin: "external-agent" },
      { kind: "activate-document", origin: "user" },
      { kind: "move-document", origin: "user" },
      { kind: "close-document", origin: "user" },
      { kind: "reopen-document", origin: "user" },
      { kind: "edit-document", origin: "ai-panel" },
    ]);
    expect(runtime.history.getState().map(({ commandId, summary, undoable }) => ({
      commandId,
      summary,
      undoable,
    }))).toEqual([
      { commandId: "tab-command-1", summary: "Open parts/wheel.scad", undoable: false },
      { commandId: "tab-command-2", summary: "Activate main.scad", undoable: false },
      { commandId: "tab-command-3", summary: "Move parts/wheel.scad to tab 1", undoable: false },
      { commandId: "tab-command-4", summary: "Close main.scad", undoable: false },
      { commandId: "tab-command-5", summary: "Reopen main.scad", undoable: false },
      { commandId: "tab-command-6", summary: "Edit parts/wheel.scad", undoable: true },
    ]);
  });

  it("does not record identity collisions or invalid move requests", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), {
      makeId: () => "document-command",
      now: () => new Date("2026-07-10T05:10:00.000Z"),
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: { id: "document-main", path: "spoof.scad", source: "sphere(9);" },
    });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "move-document",
      origin: "external-agent",
      documentId: "document-main",
      toIndex: 999,
    });

    expect(runtime.documents.getState().documents.map(({ id }) => id)).toEqual([
      "document-main",
      "document-wheel",
    ]);
    expect(runtime.history.getState()).toEqual([{
      commandId: "document-command",
      timestamp: "2026-07-10T05:10:00.000Z",
      origin: "external-agent",
      kind: "open-document",
      summary: "Open parts/wheel.scad",
      undoable: false,
    }]);
  });

  it("renders the active document snapshot with every open text buffer", async () => {
    const engine = successfulEngine();
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(engine.render).toHaveBeenCalledWith({
      entryFile: "parts/wheel.scad",
      files: new Map([
        ["main.scad", "cube(10);"],
        ["parts/wheel.scad", "cylinder(r = 4, h = 2);"],
      ]),
      parameters: {},
      quality: "full",
      timeoutMs: 600_000,
    });
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      documentId: "document-wheel",
      entryFile: "parts/wheel.scad",
    });
  });

  it("does not carry a completed mesh into a new document render", async () => {
    const completed = successfulEngine().render({
      entryFile: "main.scad",
      files: new Map(),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    }).done;
    let resolveSecond!: (result: Awaited<typeof completed>) => void;
    const second = new Promise<Awaited<typeof completed>>((resolve) => {
      resolveSecond = resolve;
    });
    const engine = successfulEngine();
    vi.mocked(engine.render)
      .mockReturnValueOnce({ jobId: "render-main", done: completed })
      .mockReturnValueOnce({ jobId: "render-wheel", done: second });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    const pending = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });

    expect(runtime.render.getState()).toEqual({
      status: "rendering",
      jobId: "render-wheel",
      quality: "preview",
      documentId: "document-wheel",
      entryFile: "parts/wheel.scad",
      sourceRevision: 0,
      sourceFiles: new Map([
        ["main.scad", "cube(10);"],
        ["parts/wheel.scad", "cylinder(r = 4, h = 2);"],
      ]),
    });
    resolveSecond(await completed);
    await pending;
  });

  it("identifies a completed render by source revision and does not surface a stale failure", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "Parser error" }],
      rawLog: "Parser error",
    };
    let resolveRender!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-revision-zero",
        done: new Promise<RenderFailure>((resolve) => {
          resolveRender = resolve;
        }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "revision-command" });
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "toggle-panel", panel: "console" },
    });
    const pending = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    resolveRender(failure);
    await pending;

    expect(runtime.render.getState()).toMatchObject({
      status: "failure",
      documentId: "document-main",
      sourceRevision: 0,
      result: failure,
    });
    expect(runtime.documents.getState().documents[0].revision).toBe(1);
    expect(runtime.layout.getState().consoleOpen).toBe(false);
  });

  it("ignores an older render that resolves after a newer job starts", async () => {
    const base = await successfulEngine().render({
      entryFile: "main.scad",
      files: new Map(),
      parameters: {},
      quality: "preview",
      timeoutMs: 30_000,
    }).done;
    if (base.kind !== "3d") throw new Error("Expected the test engine to return 3D geometry.");
    let resolveFirst!: (result: RenderSuccess3D) => void;
    let resolveSecond!: (result: RenderSuccess3D) => void;
    const engine = successfulEngine();
    vi.mocked(engine.render)
      .mockReturnValueOnce({
        jobId: "render-first",
        done: new Promise<RenderSuccess3D>((resolve) => { resolveFirst = resolve; }),
      })
      .mockReturnValueOnce({
        jobId: "render-second",
        done: new Promise<RenderSuccess3D>((resolve) => { resolveSecond = resolve; }),
      });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });

    const first = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const second = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    resolveFirst({ ...base, stats: { ...base.stats, triangles: 1 } });
    await first;
    expect(runtime.render.getState()).toMatchObject({ status: "rendering", jobId: "render-second" });
    expect(runtime.render.getState().result).toBeUndefined();

    resolveSecond({ ...base, stats: { ...base.stats, triangles: 2 } });
    await second;
    expect(runtime.render.getState()).toMatchObject({
      status: "success",
      jobId: "render-second",
      result: { stats: { triangles: 2 } },
    });
  });

  it("does not auto-open an empty console for a current background-tab failure", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "Parser error" }],
      rawLog: "Parser error",
    };
    let resolveRender!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-main",
        done: new Promise<RenderFailure>((resolve) => { resolveRender = resolve; }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "background-command" });
    await runtime.dispatch({
      kind: "open-document",
      origin: "external-agent",
      document: {
        id: "document-wheel",
        path: "parts/wheel.scad",
        source: "cylinder(r = 4, h = 2);",
      },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "toggle-panel", panel: "console" },
    });
    const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-wheel",
    });
    resolveRender(failure);
    await pending;

    expect(runtime.render.getState()).toMatchObject({
      status: "failure",
      documentId: "document-main",
      result: failure,
    });
    expect(runtime.layout.getState().consoleOpen).toBe(false);
  });

  it("does not auto-open the console when an edit-revert changed the source revision", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "Old parser error" }],
      rawLog: "Old parser error",
    };
    let resolveRender!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "render-revision-zero",
        done: new Promise<RenderFailure>((resolve) => { resolveRender = resolve; }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "revert-command" });
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "toggle-panel", panel: "console" },
    });
    const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(10);",
    });
    resolveRender(failure);
    await pending;

    expect(runtime.documents.getState().documents[0].revision).toBe(2);
    expect(runtime.layout.getState().consoleOpen).toBe(false);
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
