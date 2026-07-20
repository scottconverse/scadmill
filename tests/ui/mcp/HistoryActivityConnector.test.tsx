// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
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
});
