// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { McpPendingReview } from "../../../src/application/mcp/mcp-review-queue";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { useMcpReviewApproval } from "../../../src/ui/mcp/use-mcp-review-approval";

describe("useMcpReviewApproval", () => {
  it("applies a reviewed parameter batch as one external-agent runtime command", async () => {
    const runtime = createWorkbenchRuntime({} as EngineService, {
      initialScratchSource: "width = 10; enabled = true; cube(width);",
    });
    const review: McpPendingReview = {
      commandId: "review-1",
      tool: "set_parameters",
      arguments: { path: "main.scad", values: { width: 24, enabled: false } },
      createdAt: "2026-07-17T00:00:00Z",
    };
    const documentId = runtime.documents.getState().activeDocumentId;
    const approveReview = vi.fn().mockReturnValue(review);
    const view = renderHook(() => useMcpReviewApproval(
      runtime, runtime.documents.getState(), runtime.project.getState(), approveReview,
    ));

    await view.result.current.approve(review);

    expect(runtime.parameters.getState().documents.get(documentId)?.overrides).toEqual({ width: 24, enabled: false });
    expect(runtime.history.getState().at(-1)).toMatchObject({ origin: "external-agent", kind: "update-parameters" });
    expect(approveReview).toHaveBeenCalledWith("review-1");
    runtime.dispose();
  });
});
