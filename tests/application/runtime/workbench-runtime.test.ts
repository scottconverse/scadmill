import { describe, expect, it, vi } from "vitest";

import type {
  EngineService,
  RenderFailure,
  RenderSuccess2D,
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
    expect(runtime.viewer.getState().documents.get("document-main")?.presentation).toMatchObject({
      modelIdentity: "render-1",
      quality: "preview",
      result: { kind: "3d", stats: { triangles: 12 } },
    });
    expect(engine.render).toHaveBeenCalledWith({
      entryFile: "main.scad",
      files: new Map([["main.scad", "cube([10, 20, 30]);"]]),
      parameters: {},
      previewFacetLimit: 48,
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

  it("presents a successful two-dimensional render in the active document viewer", async () => {
    const drawing: RenderSuccess2D = {
      kind: "2d",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L30 0 L30 -20 Z"/></svg>',
      boundingBox: { min: [0, 0], max: [30, 20] },
      diagnostics: [],
      rawLog: "rendered 2D",
    };
    const engine = successfulEngine();
    vi.mocked(engine.render).mockReturnValue({
      jobId: "render-2d",
      subscribeOutput: () => () => undefined,
      done: Promise.resolve(drawing),
    });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-2d-command" });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(runtime.viewer.getState().documents.get("document-main")?.presentation).toMatchObject({
      modelIdentity: "render-2d",
      quality: "preview",
      result: drawing,
    });
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
      .mockReturnValueOnce({
        jobId: "render-main",
        subscribeOutput: () => () => undefined,
        done: completed,
      })
      .mockReturnValueOnce({
        jobId: "render-wheel",
        subscribeOutput: () => () => undefined,
        done: second,
      });
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
      projectRevision: 0,
      parameterValues: {},
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
        subscribeOutput: () => () => undefined,
        done: new Promise<RenderSuccess3D>((resolve) => { resolveFirst = resolve; }),
      })
      .mockReturnValueOnce({
        jobId: "render-second",
        subscribeOutput: () => () => undefined,
        done: new Promise<RenderSuccess3D>((resolve) => { resolveSecond = resolve; }),
      });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "render-command" });

    const first = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const second = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    expect(engine.cancel).toHaveBeenCalledWith("render-first");
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

  it("routes an explicit cancel command to only the active native job", async () => {
    let resolveRender!: (result: RenderFailure) => void;
    const engine = successfulEngine();
    vi.mocked(engine.render).mockReturnValue({
      jobId: "render-cancelled",
      subscribeOutput: () => () => undefined,
      done: new Promise<RenderFailure>((resolve) => { resolveRender = resolve; }),
    });
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "cancel-command" });
    const pending = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });

    await runtime.dispatch({ kind: "cancel-render", origin: "user" });
    expect(engine.cancel).toHaveBeenCalledTimes(1);
    expect(engine.cancel).toHaveBeenCalledWith("render-cancelled");

    resolveRender({
      kind: "failure",
      reason: "cancelled",
      diagnostics: [],
      rawLog: "cancelled",
    });
    await pending;
    await runtime.dispatch({ kind: "cancel-render", origin: "user" });
    expect(engine.cancel).toHaveBeenCalledTimes(1);
  });

  it("records editor command invocations on the shared command bus", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), {
      makeId: () => "editor-command-id",
    });

    await runtime.dispatch({
      kind: "editor-command",
      origin: "user",
      outcome: { command: "toggle-comment", status: "handled" },
    });

    expect(runtime.history.getState()).toContainEqual({
      commandId: "editor-command-id",
      timestamp: expect.any(String),
      origin: "user",
      kind: "editor-command",
      summary: "Editor command: toggle-comment",
      undoable: false,
    });
  });

  it("debounces rapid edits into exactly one completed automatic preview", async () => {
    vi.useFakeTimers();
    try {
      const engine = successfulEngine();
      let completed = 0;
      vi.mocked(engine.render).mockImplementation(() => ({
        jobId: "auto-render",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve<RenderFailure>({
          kind: "failure",
          reason: "engine-error",
          diagnostics: [],
          rawLog: "test",
        }).then((result) => {
          completed += 1;
          return result;
        }),
      }));
      const runtime = createWorkbenchRuntime(engine, { makeId: () => "auto-command" });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });

      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(11);",
      });
      await vi.advanceTimersByTimeAsync(400);
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(12);",
      });
      await vi.advanceTimersByTimeAsync(799);
      expect(engine.render).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(engine.render).toHaveBeenCalledTimes(1);
      expect(engine.render).toHaveBeenCalledWith(expect.objectContaining({
        entryFile: "main.scad",
        quality: "preview",
        timeoutMs: 30_000,
      }));
      expect(completed).toBe(1);
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the configured default quality for automatic renders", async () => {
    vi.useFakeTimers();
    try {
      const engine = successfulEngine();
      const runtime = createWorkbenchRuntime(engine, { makeId: () => "auto-full-command" });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({
        kind: "replace-settings",
        origin: "user",
        settings: {
          ...runtime.settings.getState().profile,
          rendering: {
            ...runtime.settings.getState().profile.rendering,
            defaultQuality: "full",
          },
        },
      });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(22);",
      });

      await vi.advanceTimersByTimeAsync(800);

      expect(engine.render).toHaveBeenCalledTimes(1);
      expect(engine.render).toHaveBeenCalledWith(expect.objectContaining({
        quality: "full",
        timeoutMs: 600_000,
      }));
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("can turn automatic rendering off and disposes a pending timer", async () => {
    vi.useFakeTimers();
    try {
      const engine = successfulEngine();
      const runtime = createWorkbenchRuntime(engine, { makeId: () => "auto-off-command" });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });
      await runtime.dispatch({ kind: "set-auto-render", origin: "user", enabled: false });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(20);",
      });
      await vi.advanceTimersByTimeAsync(800);
      expect(engine.render).not.toHaveBeenCalled();

      await runtime.dispatch({ kind: "set-auto-render", origin: "user", enabled: true });
      await runtime.dispatch({
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "cube(21);",
      });
      runtime.dispose();
      await vi.advanceTimersByTimeAsync(800);
      expect(engine.render).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams and finishes each engine run in a separate console record", async () => {
    let emit!: (event: {
      sequence: number;
      elapsedMs: number;
      stream: "stdout" | "stderr";
      raw: string;
    }) => void;
    let resolve!: (result: RenderFailure) => void;
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({
        jobId: "streamed-run",
        subscribeOutput(listener: typeof emit) {
          emit = listener;
          return vi.fn();
        },
        done: new Promise<RenderFailure>((done) => { resolve = done; }),
      }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const times = [100, 112];
    const runtime = createWorkbenchRuntime(engine, {
      makeId: () => "stream-command",
      nowMs: () => times.shift() ?? 112,
    });

    const pending = runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    emit({ sequence: 0, elapsedMs: 3, stream: "stdout", raw: "ECHO: one\n" });
    expect(runtime.console.getState()).toMatchObject({
      retainedLineCount: 1,
      runs: [{ jobId: "streamed-run", status: "running", lines: [{ raw: "ECHO: one\n" }] }],
    });
    resolve({
      kind: "failure",
      reason: "engine-error",
      exitCode: 1,
      diagnostics: [{ severity: "echo", message: "one" }],
      rawLog: "ECHO: one\n",
    });
    await pending;

    expect(runtime.console.getState().runs[0]).toMatchObject({
      status: "engine-error",
      durationMs: 12,
      exitCode: 1,
      diagnostics: [{ severity: "echo", message: "one" }],
      lines: [{ raw: "ECHO: one\n" }],
    });
  });

  it("clears console history without erasing the current render result", async () => {
    const runtime = createWorkbenchRuntime(successfulEngine(), { makeId: () => "clear-command" });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    expect(runtime.console.getState().runs).toHaveLength(1);
    expect(runtime.render.getState().result).toBeDefined();

    await runtime.dispatch({ kind: "clear-console", origin: "user" });

    expect(runtime.console.getState().runs).toEqual([]);
    expect(runtime.render.getState().result).toBeDefined();
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

    expect(runtime.settings.getState()).toMatchObject({
      theme: "system",
      autoRender: true,
      engineAvailable: false,
      renderDebounceMs: 800,
      previewTimeoutMs: 30_000,
      fullTimeoutMs: 600_000,
      previewFacetLimit: 48,
    });
    expect(runtime.settings.getState().editor).toMatchObject({ fontSize: 14, tabWidth: 4 });
    expect(runtime.settings.getState().keybindings.renderPreview).toBe("F5");

    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "high-contrast" });
    await runtime.dispatch({ kind: "set-theme", origin: "user", theme: "high-contrast" });

    expect(runtime.settings.getState()).toMatchObject({ theme: "high-contrast" });
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
