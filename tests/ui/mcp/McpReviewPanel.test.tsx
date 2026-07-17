// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { McpReviewPanel } from "../../../src/ui/mcp/McpReviewPanel";

describe("McpReviewPanel", () => {
  it("shows pending external parameter changes, applies only after approval, and badges applied history", async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const deny = vi.fn();
    const view = render(
      <McpReviewPanel
        history={[{ commandId: "history-1", timestamp: "2026-07-17T00:00:00Z", origin: "external-agent", kind: "update-parameters", summary: "Update parameters", undoable: true }]}
        pendingReviews={[{ commandId: "review-1", tool: "set_parameters", arguments: { path: "main.scad", values: { width: 24 } }, createdAt: "2026-07-17T00:00:00Z" }]}
        sourceForPath={() => "cube(1);"}
        onApprove={approve}
        onDeny={deny}
      />,
    );

    expect(view.getByText("MCP parameter change: main.scad")).toBeVisible();
    expect(view.getByText("External agent")).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    fireEvent.click(view.getByRole("button", { name: "Deny change" }));
    expect(deny).toHaveBeenCalledWith("review-1");
  });
});
