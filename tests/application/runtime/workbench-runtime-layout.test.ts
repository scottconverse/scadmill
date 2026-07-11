import { describe, expect, it, vi } from "vitest";

import type {
  EngineService,
  RenderFailure,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
import {
  DEFAULT_WORKSPACE_LAYOUT,
  serializeWorkspaceLayout,
} from "../../../src/application/layout/workspace-layout";
import type { WorkspaceLayoutPersistence } from "../../../src/application/runtime/layout-persistence";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

function idleEngine(): EngineService {
  const result: RenderSuccess3D = {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: new Uint8Array() },
    stats: { engineTimeMs: 1 },
    diagnostics: [],
    rawLog: "",
  };
  return {
    render: vi.fn().mockReturnValue({ jobId: "unexpected-render", done: Promise.resolve(result) }),
    export: vi.fn(),
    version: vi.fn().mockResolvedValue(null),
    cancel: vi.fn(),
  };
}

function memoryPersistence(): WorkspaceLayoutPersistence & { current(): string | null } {
  let stored: string | null = null;
  return {
    load: () => stored,
    save: (serializedLayout) => {
      stored = serializedLayout;
    },
    current: () => stored,
  };
}

describe("workbench runtime layout", () => {
  it("hydrates a readonly layout store through synchronous persistence", () => {
    const persisted = serializeWorkspaceLayout({
      activeRail: "history",
      dockOpen: false,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: false,
      consoleOpen: true,
      dockWidth: 312,
      viewerWidth: 640,
      parameterHeight: 176,
      consoleHeight: 240,
      maximized: null,
      narrowView: "model",
      narrowDockOpen: false,
      narrowSheet: null,
    });
    const persistence = {
      load: vi.fn(() => persisted),
      save: vi.fn(),
    };

    const runtime = createWorkbenchRuntime(idleEngine(), { layoutPersistence: persistence });

    expect(persistence.load).toHaveBeenCalledOnce();
    expect(runtime.layout.getState()).toMatchObject({
      activeRail: "history",
      dockOpen: false,
      parameterOpen: false,
      dockWidth: 312,
      viewerWidth: 640,
      parameterHeight: 176,
      consoleHeight: 240,
      narrowView: "model",
    });
    expect(runtime.layout).not.toHaveProperty("setState");
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it("records and saves exactly once for a real layout command and ignores no-ops", async () => {
    const persistence = {
      load: vi.fn(() => serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT)),
      save: vi.fn(),
    };
    const makeId = vi.fn()
      .mockReturnValueOnce("layout-command-1")
      .mockReturnValueOnce("layout-command-2");
    const runtime = createWorkbenchRuntime(idleEngine(), {
      layoutPersistence: persistence,
      makeId,
      now: () => new Date("2026-07-10T07:00:00.000Z"),
    });

    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "resize-panel", panel: "dock", size: 340 },
    });
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "resize-panel", panel: "dock", size: 340 },
    });
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "reset-layout" },
    });
    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "reset-layout" },
    });

    expect(runtime.layout.getState()).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    expect(makeId).toHaveBeenCalledTimes(2);
    expect(persistence.save).toHaveBeenCalledTimes(2);
    expect(persistence.save.mock.calls).toEqual([
      [serializeWorkspaceLayout({ ...DEFAULT_WORKSPACE_LAYOUT, dockWidth: 340 })],
      [serializeWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT)],
    ]);
    expect(runtime.history.getState()).toEqual([
      {
        commandId: "layout-command-1",
        timestamp: "2026-07-10T07:00:00.000Z",
        origin: "user",
        kind: "update-layout",
        summary: "Resize dock",
        undoable: false,
      },
      {
        commandId: "layout-command-2",
        timestamp: "2026-07-10T07:00:00.000Z",
        origin: "user",
        kind: "update-layout",
        summary: "Reset workspace layout",
        undoable: false,
      },
    ]);
  });

  it("persists one keyed console auto-open for a failed job without adding history", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [{ severity: "error", message: "Parser error" }],
      rawLog: "Parser error",
    };
    const success: RenderSuccess3D = {
      kind: "3d",
      mesh: { format: "stl-binary", bytes: new Uint8Array() },
      stats: { engineTimeMs: 1 },
      diagnostics: [],
      rawLog: "rendered",
    };
    const engine = idleEngine();
    vi.mocked(engine.render)
      .mockReturnValueOnce({
        jobId: "render-1",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve(failure),
      })
      .mockReturnValueOnce({
        jobId: "render-1",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve(failure),
      })
      .mockReturnValueOnce({
        jobId: "render-2",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve(success),
      });
    const persistence = { load: vi.fn(() => null), save: vi.fn() };
    const runtime = createWorkbenchRuntime(engine, {
      layoutPersistence: persistence,
      makeId: (() => {
        let next = 0;
        return () => `command-${++next}`;
      })(),
      now: () => new Date("2026-07-10T07:15:00.000Z"),
    });

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(runtime.layout.getState()).toMatchObject({
      consoleOpen: true,
      consoleAutoOpenedForJobId: "render-1",
    });
    expect(runtime.history.getState()).toHaveLength(1);

    await runtime.dispatch({
      kind: "update-layout",
      origin: "user",
      action: { kind: "toggle-panel", panel: "console" },
    });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" });

    expect(runtime.layout.getState()).toMatchObject({
      consoleOpen: false,
      consoleAutoOpenedForJobId: "render-1",
    });
    expect(persistence.save).toHaveBeenCalledTimes(2);
    expect(runtime.history.getState().map((entry) => entry.kind)).toEqual([
      "render-active",
      "update-layout",
      "render-active",
      "render-active",
    ]);
  });

  it("does not auto-open the console for a cancelled render", async () => {
    const cancelled: RenderFailure = {
      kind: "failure",
      reason: "cancelled",
      diagnostics: [],
      rawLog: "cancelled",
    };
    const engine = idleEngine();
    vi.mocked(engine.render).mockReturnValue({
      jobId: "render-cancelled",
      subscribeOutput: () => () => undefined,
      done: Promise.resolve(cancelled),
    });
    const runtime = createWorkbenchRuntime(engine);

    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });

    expect(runtime.render.getState()).toMatchObject({ status: "failure", result: cancelled });
    expect(runtime.layout.getState()).toMatchObject({
      consoleOpen: false,
      narrowSheet: null,
    });
    expect(runtime.layout.getState().consoleAutoOpenedForJobId).toBeUndefined();
  });

  it("recreates durable sizes, collapse state, and rail while resetting ephemeral layout state", async () => {
    const persistence = memoryPersistence();
    const first = createWorkbenchRuntime(idleEngine(), { layoutPersistence: persistence });
    const actions = [
      { kind: "resize-panel", panel: "dock", size: 360 },
      { kind: "resize-panel", panel: "viewer", size: 690 },
      { kind: "resize-panel", panel: "parameter", size: 310 },
      { kind: "resize-panel", panel: "console", size: 270 },
      { kind: "activate-rail", panel: "libraries", narrow: false },
      { kind: "toggle-panel", panel: "dock" },
      { kind: "toggle-panel", panel: "editor" },
      { kind: "toggle-panel", panel: "parameter" },
      { kind: "toggle-maximize", region: "viewer" },
      { kind: "set-narrow-sheet", sheet: "console" },
      { kind: "render-failed", jobId: "ephemeral-job" },
    ] as const;

    for (const action of actions) {
      await first.dispatch({ kind: "update-layout", origin: "user", action });
    }

    expect(first.layout.getState()).toMatchObject({
      activeRail: "libraries",
      dockOpen: false,
      editorOpen: false,
      parameterOpen: false,
      dockWidth: 360,
      viewerWidth: 690,
      parameterHeight: 310,
      consoleHeight: 270,
      maximized: null,
      narrowSheet: "console",
      consoleAutoOpenedForJobId: "ephemeral-job",
    });
    expect(persistence.current()).not.toBeNull();

    const recreated = createWorkbenchRuntime(idleEngine(), { layoutPersistence: persistence });

    expect(recreated.layout.getState()).toMatchObject({
      activeRail: "libraries",
      dockOpen: false,
      editorOpen: false,
      viewerOpen: true,
      parameterOpen: false,
      consoleOpen: true,
      dockWidth: 360,
      viewerWidth: 690,
      parameterHeight: 310,
      consoleHeight: 270,
      maximized: null,
      narrowDockOpen: false,
      narrowSheet: null,
    });
    expect(recreated.layout.getState().consoleAutoOpenedForJobId).toBeUndefined();
  });
});
