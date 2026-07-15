// @vitest-environment happy-dom
import { act, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type {
  EngineService,
  RenderFailure,
} from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { messages } from "../../../src/messages/en";
import { Workbench } from "../../../src/ui/Workbench";

it("keeps runtime render elapsed time when Workbench remounts the active viewer", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T12:00:00Z"));
  let resolveRender!: (result: RenderFailure) => void;
  const done = new Promise<RenderFailure>((resolve) => { resolveRender = resolve; });
  const engine: EngineService = {
    render: vi.fn().mockReturnValue({ jobId: "runtime-job", done }),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, {
    makeId: () => "timer-command",
    now: () => new Date(Date.now()),
    nowMs: () => Date.now(),
  });
  let view: ReturnType<typeof render> | undefined;
  try {
    await runtime.dispatch({
      kind: "open-document",
      origin: "user",
      document: { id: "document-b", path: "b.scad", source: "cube(2);" },
    });
    await runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    });
    const pendingRender = runtime.dispatch({
      kind: "render-active",
      origin: "user",
      quality: "preview",
    });
    const startedAtMs = Date.now();
    expect(runtime.render.getState()).toMatchObject({
      startedAtMs,
      startedAtMonotonicMs: expect.any(Number),
      status: "rendering",
    });

    view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        engineLabel="OpenSCAD 2026.06.12"
        runtime={runtime}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    let workbench = within(view.container);
    expect(workbench.getByRole("group", { name: messages.renderProgress }))
      .toHaveTextContent(messages.renderingElapsed(0));

    act(() => vi.advanceTimersByTime(1_200));
    expect(workbench.getByRole("group", { name: messages.renderProgress }))
      .toHaveTextContent(messages.renderingElapsed(1.2));

    await act(async () => runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-b",
    }));
    expect(workbench.queryByRole("group", { name: messages.renderProgress })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(800));
    vi.setSystemTime(new Date("2026-07-11T11:59:30Z"));

    await act(async () => runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    }));
    workbench = within(view.container);
    expect(workbench.getByRole("group", { name: messages.renderProgress }))
      .toHaveTextContent(messages.renderingElapsed(2));

    await act(async () => runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-b",
    }));
    act(() => vi.advanceTimersByTime(500));
    vi.setSystemTime(new Date("2026-07-11T13:00:00Z"));
    await act(async () => runtime.dispatch({
      kind: "activate-document",
      origin: "user",
      documentId: "document-main",
    }));
    workbench = within(view.container);
    expect(workbench.getByRole("group", { name: messages.renderProgress }))
      .toHaveTextContent(messages.renderingElapsed(2.5));

    resolveRender({
      kind: "failure",
      reason: "cancelled",
      diagnostics: [],
      rawLog: "",
    });
    await act(async () => pendingRender);
  } finally {
    view?.unmount();
    runtime.dispose();
    vi.useRealTimers();
  }
});
