import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";

function engine(): EngineService {
  return {
    render: vi.fn().mockReturnValue({
      jobId: "history-render",
      done: Promise.resolve({
        kind: "failure",
        reason: "engine-error",
        diagnostics: [],
        rawLog: "history test",
      }),
      subscribeOutput: () => () => undefined,
    }),
    export: vi.fn(),
    version: vi.fn().mockResolvedValue({ version: "2026.06.12", path: "native", features: [] }),
    cancel: vi.fn(),
  };
}

function observable(runtime: ReturnType<typeof createWorkbenchRuntime>) {
  const document = runtime.documents.getState().documents.find(({ id }) => id === "document-main");
  const parameters = runtime.parameters.getState().documents.get("document-main");
  return {
    source: document?.source,
    overrides: parameters ? { ...parameters.overrides } : undefined,
    revisionsAligned: document?.revision === parameters?.revision,
  };
}

describe("AC-11.a reversible command history", () => {
  it("undoes and redoes a scripted edit/parameter/source-write sequence without adding history", async () => {
    const runtime = createWorkbenchRuntime(engine(), {
      initialScratchSource: "width = 10; depth = 5; cube([width, depth, 1]);",
      makeId: (() => { let id = 0; return () => `history-${++id}`; })(),
      rendering: { autoRender: false },
    });
    const actions = [
      {
        kind: "edit-document",
        origin: "user",
        documentId: "document-main",
        source: "width = 12; depth = 5; cube([width, depth, 1]);",
      },
      {
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 20 },
      },
      {
        kind: "update-parameters",
        origin: "external-agent",
        action: {
          kind: "set-values",
          documentId: "document-main",
          values: { width: 30, depth: 8 },
        },
      },
      { kind: "write-parameter-values", origin: "user", documentId: "document-main" },
    ] as const;
    const states = [observable(runtime)];

    for (const [index, action] of actions.entries()) {
      await runtime.dispatch(action);
      states.push(observable(runtime));
      expect(runtime.history.getState()).toHaveLength(index + 1);
      expect(runtime.history.getState().at(-1)?.undoable).toBe(true);
      expect(observable(runtime).revisionsAligned).toBe(true);
    }
    const originalHistory = runtime.history.getState();

    for (let index = actions.length - 1; index >= 0; index -= 1) {
      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      expect(observable(runtime)).toEqual(states[index]);
      expect(runtime.history.getState()).toEqual(originalHistory);
    }
    for (let index = 1; index <= actions.length; index += 1) {
      await runtime.dispatch({ kind: "history-redo", origin: "user" });
      expect(observable(runtime)).toEqual(states[index]);
      expect(runtime.history.getState()).toEqual(originalHistory);
    }
  });

  it("installs the inverse before publishing an undoable entry", async () => {
    const runtime = createWorkbenchRuntime(engine(), { rendering: { autoRender: false } });
    let reactiveUndo: Promise<void> | undefined;
    const unsubscribe = runtime.history.subscribe((entries) => {
      if (entries.at(-1)?.undoable) {
        reactiveUndo = runtime.dispatch({ kind: "history-undo", origin: "user" });
      }
    });

    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await reactiveUndo;

    expect(observable(runtime).source).toBe("cube(10);");
    expect(runtime.history.getState()).toHaveLength(1);
    unsubscribe();
  });

  it("does not replay an older edit across a newer source-replacement barrier", async () => {
    const runtime = createWorkbenchRuntime(engine(), { rendering: { autoRender: false } });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({
      kind: "resolve-external-change",
      origin: "user",
      documentId: "document-main",
      diskSource: "sphere(4);",
      choice: "reload",
    });

    await runtime.dispatch({ kind: "history-undo", origin: "user" });

    expect(observable(runtime).source).toBe("sphere(4);");
    expect(runtime.history.getState()).toHaveLength(2);
  });

  it("retains preview quality when undoing parameter values written into source", async () => {
    vi.useFakeTimers();
    try {
      const nativeEngine = engine();
      const runtime = createWorkbenchRuntime(nativeEngine, {
        initialScratchSource: "width = 10; cube(width);",
        rendering: { autoRender: false, defaultQuality: "full" },
      });
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "user",
        action: { kind: "set-value", documentId: "document-main", name: "width", value: 20 },
      });
      await runtime.dispatch({
        kind: "write-parameter-values",
        origin: "user",
        documentId: "document-main",
      });
      await runtime.dispatch({ kind: "set-auto-render", origin: "user", enabled: true });
      await runtime.dispatch({
        kind: "engine-availability-changed",
        origin: "system",
        available: true,
      });

      await runtime.dispatch({ kind: "history-undo", origin: "user" });
      await vi.advanceTimersByTimeAsync(800);

      expect(nativeEngine.render).toHaveBeenCalledOnce();
      expect(vi.mocked(nativeEngine.render).mock.calls[0]?.[0].quality).toBe("preview");
      runtime.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the redo branch after a fresh mutation", async () => {
    const runtime = createWorkbenchRuntime(engine(), { rendering: { autoRender: false } });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(11);",
    });
    await runtime.dispatch({ kind: "history-undo", origin: "user" });
    await runtime.dispatch({
      kind: "edit-document",
      origin: "ai-panel",
      documentId: "document-main",
      source: "sphere(7);",
    });
    await runtime.dispatch({ kind: "history-redo", origin: "user" });

    expect(observable(runtime).source).toBe("sphere(7);");
    expect(runtime.history.getState().map(({ kind, origin }) => ({ kind, origin }))).toEqual([
      { kind: "edit-document", origin: "user" },
      { kind: "edit-document", origin: "ai-panel" },
    ]);
  });
});
