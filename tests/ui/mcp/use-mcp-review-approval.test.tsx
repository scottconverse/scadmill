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
      origin: "external-agent",
    };
    const documentId = runtime.documents.getState().activeDocumentId;
    const approveReview = vi.fn().mockReturnValue(review);
    const restoreReview = vi.fn();
    const view = renderHook(() => useMcpReviewApproval(
      runtime, runtime.documents.getState(), runtime.project.getState(), approveReview, restoreReview,
    ));

    await view.result.current.approve(review);

    expect(runtime.parameters.getState().documents.get(documentId)?.overrides).toEqual({ width: 24, enabled: false });
    expect(runtime.history.getState().at(-1)).toMatchObject({ origin: "external-agent", kind: "update-parameters" });
    expect(approveReview).toHaveBeenCalledWith("review-1");
    runtime.dispose();
  });

  it("records an AI agent auto-apply with AI-panel origin", async () => {
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const review: McpPendingReview = {
      commandId: "review-ai",
      tool: "write_file",
      arguments: { path: "main.scad", content: "cube(4);" },
      createdAt: "2026-07-17T00:00:00Z",
      origin: "ai-panel",
    };
    const approveReview = vi.fn().mockReturnValue(review);
    const restoreReview = vi.fn();
    const view = renderHook(() => useMcpReviewApproval(
      runtime, runtime.documents.getState(), runtime.project.getState(), approveReview, restoreReview,
    ));
    await view.result.current.approve(review);
    expect(runtime.documents.getState().documents[0]?.source).toBe("cube(4);");
    expect(runtime.history.getState().at(-1)).toMatchObject({ origin: "ai-panel", kind: "edit-document" });
    runtime.dispose();
  });

  it("claims a review before mutation so a concurrent second approval cannot apply twice", async () => {
    const runtime = createWorkbenchRuntime({} as EngineService, { initialScratchSource: "cube(1);" });
    const review: McpPendingReview = { commandId: "race", tool: "write_file", arguments: { path: "main.scad", content: "cube(2);" }, createdAt: "2026-07-17T00:00:00Z", origin: "ai-panel" };
    let available = true;
    const claim = vi.fn(() => { if (!available) return undefined; available = false; return review; });
    const restore = vi.fn();
    const view = renderHook(() => useMcpReviewApproval(runtime, runtime.documents.getState(), runtime.project.getState(), claim, restore));
    await view.result.current.approve(review);
    await expect(view.result.current.approve(review)).rejects.toThrow("no longer pending");
    expect(runtime.history.getState().filter(({ origin }) => origin === "ai-panel")).toHaveLength(1);
    runtime.dispose();
  });
});
