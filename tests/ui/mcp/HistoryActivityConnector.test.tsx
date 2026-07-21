// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess2D } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { HistoryActivityConnector } from "../../../src/ui/mcp/HistoryActivityConnector";

describe("HistoryActivityConnector", () => {
  it("owns live history and detail updates without rerendering its parent", async () => {
    const engine: EngineService = {
      render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    let parentRenders = 0;
    function Parent() {
      parentRenders += 1;
      return <HistoryActivityConnector
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        pendingReviews={[]}
        runtime={runtime}
        sourceForPath={() => "cube(10);"}
      />;
    }
    const view = render(<Parent />);
    const baselineRenders = parentRenders;

    await act(() => runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(20);",
    }));
    expect(parentRenders).toBe(baselineRenders);
    const detailButton = screen.getByRole("button", { name: /^View command detail: Edit main\.scad/u });
    fireEvent.click(detailButton);
    expect(screen.getByRole("article", { name: "Command detail" })).toHaveTextContent("cube(20);");

    view.unmount();
    await runtime.dispatch({ kind: "clear-console", origin: "user" });
    render(<Parent />);
    expect(screen.getByText("Clear console")).toBeVisible();
    runtime.dispose();
  });

  it("connects accepted renders to the active document model timeline", async () => {
    const result: RenderSuccess2D = {
      kind: "2d",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      boundingBox: { min: [0, 0], max: [10, 10] },
      diagnostics: [],
      rawLog: "",
    };
    const engine: EngineService = {
      render: vi.fn(() => ({
        jobId: "timeline-render",
        done: Promise.resolve(result),
        subscribeOutput: () => () => undefined,
      })),
      export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, {
      renderCache: null,
      rendering: { autoRender: false },
    });
    render(
      <HistoryActivityConnector
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        pendingReviews={[]}
        runtime={runtime}
        sourceForPath={() => "cube(10);"}
      />,
    );

    await act(() => runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" }));

    expect(screen.getByRole("slider", { name: "Model history snapshot" })).toHaveValue("0");
    expect(screen.getByRole("button", { name: "Restore snapshot 1" })).toBeVisible();
    runtime.dispose();
  });
});
