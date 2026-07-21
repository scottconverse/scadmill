// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EngineService, RenderFailure, RenderSuccess3D } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { AnimationBar } from "../../../src/ui/animation/AnimationBar";

const success: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { triangles: 0, engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "rendered",
};

function engine(): EngineService {
  let job = 0;
  return {
    render: vi.fn(() => ({
      jobId: `animation-${++job}`,
      subscribeOutput: () => () => undefined,
      done: Promise.resolve(success),
    })),
    export: vi.fn(),
    version: vi.fn().mockResolvedValue({ version: "2026.07", path: "native", features: [] }),
    cancel: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AnimationBar", () => {
  it("appears only for executable $t use and scrubs to an exact preview frame", async () => {
    const renderEngine = engine();
    const runtime = createWorkbenchRuntime(renderEngine, { renderCache: null });
    const view = render(
      <AnimationBar
        documentId="document-main"
        engineAvailable
        runtime={runtime}
        source="cube(10);"
      />,
    );

    expect(screen.queryByRole("region", { name: "Animation" })).not.toBeInTheDocument();
    view.rerender(
      <AnimationBar
        documentId="document-main"
        engineAvailable
        runtime={runtime}
        source="rotate([0, 0, $t * 360]) cube(10);"
      />,
    );

    fireEvent.change(screen.getByRole("slider", { name: "Animation frame" }), {
      target: { value: "50" },
    });

    await waitFor(() => expect(renderEngine.render).toHaveBeenCalledOnce());
    expect(vi.mocked(renderEngine.render).mock.calls[0][0]).toMatchObject({
      quality: "preview",
      parameters: { $t: 50 / 100 },
    });
    expect(screen.getByText(/Frame 51 of 100/u)).toBeVisible();
    expect(screen.getByRole("slider", { name: "Animation frame" })).toHaveAttribute(
      "aria-valuetext",
      "Frame 51 of 100",
    );
  });

  it("serializes playback at the selected FPS and pause prevents another frame", async () => {
    vi.useFakeTimers();
    const renderEngine = engine();
    let finishFirst!: (result: RenderSuccess3D) => void;
    vi.mocked(renderEngine.render).mockReturnValueOnce({
      jobId: "slow-animation",
      subscribeOutput: () => () => undefined,
      done: new Promise<RenderSuccess3D>((resolve) => { finishFirst = resolve; }),
    });
    const runtime = createWorkbenchRuntime(renderEngine, { renderCache: null });
    const waitForPresentation = vi.fn().mockResolvedValue(undefined);
    render(
      <AnimationBar
        documentId="document-main"
        engineAvailable
        runtime={runtime}
        source="rotate($t * 360) cube(10);"
        waitForPresentation={waitForPresentation}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Animation FPS" }), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    await act(async () => { await Promise.resolve(); });

    expect(renderEngine.render).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(renderEngine.render).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pause animation" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
    await act(async () => { await Promise.resolve(); });
    expect(renderEngine.cancel).toHaveBeenCalledWith("slow-animation");
    await act(async () => {
      finishFirst(success);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(renderEngine.render).toHaveBeenCalledTimes(1);
    expect(waitForPresentation).not.toHaveBeenCalled();
  });

  it("aborts the active presentation wait when playback is paused", async () => {
    const renderEngine = engine();
    const runtime = createWorkbenchRuntime(renderEngine, { renderCache: null });
    let waitSignal: AbortSignal | undefined;
    const waitForPresentation = vi.fn((_token?: string, signal?: AbortSignal) => {
      waitSignal = signal;
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    });
    render(
      <AnimationBar
        documentId="document-main"
        engineAvailable
        runtime={runtime}
        source="rotate($t * 360) cube(10);"
        waitForPresentation={waitForPresentation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    await waitFor(() => expect(waitForPresentation).toHaveBeenCalledOnce());
    expect(waitForPresentation).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(AbortSignal),
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));

    expect(waitSignal?.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Play animation" })).toBeVisible());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(renderEngine.render).toHaveBeenCalledOnce();
  });

  it("does not create a presentation waiter after unmounting during engine dispatch", async () => {
    const renderEngine = engine();
    let finish!: (result: RenderSuccess3D) => void;
    vi.mocked(renderEngine.render).mockReturnValueOnce({
      jobId: "unmounted-animation",
      subscribeOutput: () => () => undefined,
      done: new Promise<RenderSuccess3D>((resolve) => { finish = resolve; }),
    });
    const runtime = createWorkbenchRuntime(renderEngine, { renderCache: null });
    const waitForPresentation = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <AnimationBar
        documentId="document-main"
        engineAvailable
        runtime={runtime}
        source="cube(5 + $t);"
        waitForPresentation={waitForPresentation}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    await waitFor(() => expect(renderEngine.render).toHaveBeenCalledOnce());

    view.unmount();
    await act(async () => { finish(success); await Promise.resolve(); });

    expect(waitForPresentation).not.toHaveBeenCalled();
  });

  it("stops immediately when an animation frame fails in the engine", async () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "engine-error",
      diagnostics: [],
      rawLog: "frame failed",
    };
    const renderEngine = engine();
    vi.mocked(renderEngine.render).mockReturnValueOnce({
      jobId: "failed-animation",
      subscribeOutput: () => () => undefined,
      done: Promise.resolve(failure),
    });
    const runtime = createWorkbenchRuntime(renderEngine, { renderCache: null });
    const waitForPresentation = vi.fn().mockResolvedValue(undefined);
    render(
      <AnimationBar
        documentId="document-main"
        engineAvailable
        runtime={runtime}
        source="cube(5 + $t);"
        waitForPresentation={waitForPresentation}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Animation stopped: The animation frame could not be rendered.",
    );
    expect(waitForPresentation).not.toHaveBeenCalled();
    expect(runtime.render.getState().presentationToken).toBeUndefined();
  });

  it("disables playback when the engine is unavailable", () => {
    const runtime = createWorkbenchRuntime(engine(), { renderCache: null });
    render(
      <AnimationBar
        documentId="document-main"
        engineAvailable={false}
        runtime={runtime}
        source="cube(5 + $t);"
      />,
    );

    expect(screen.getByRole("button", { name: "Play animation" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Animation frame" })).toBeDisabled();
  });

  it("surfaces a rejected frame dispatch and leaves playback stopped", async () => {
    const renderEngine = engine();
    vi.mocked(renderEngine.render).mockImplementation(() => {
      throw new Error("adapter offline");
    });
    const runtime = createWorkbenchRuntime(renderEngine, { renderCache: null });
    render(
      <AnimationBar
        documentId="document-main"
        engineAvailable
        runtime={runtime}
        source="cube(5 + $t);"
      />,
    );

    fireEvent.change(screen.getByRole("slider", { name: "Animation frame" }), {
      target: { value: "20" },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Animation stopped: adapter offline",
    );
    expect(screen.getByRole("button", { name: "Play animation" })).toBeVisible();
  });
});
