// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { McpReviewPanel } from "../../../src/ui/mcp/McpReviewPanel";

describe("McpReviewPanel", () => {
  it("reviews pending MCP changes and selects newest-first command details with every origin badge", async () => {
    const approve = vi.fn().mockResolvedValue(undefined);
    const deny = vi.fn();
    const view = render(
      <McpReviewPanel
        history={[
          { commandId: "history-user", timestamp: "2026-07-17T00:00:00Z", origin: "user", kind: "edit-document", summary: "Edit main.scad", undoable: true },
          { commandId: "history-ai", timestamp: "2026-07-17T00:00:01Z", origin: "ai-panel", kind: "edit-document", summary: "Apply AI edit", undoable: true },
          { commandId: "history-external", timestamp: "2026-07-17T00:00:02Z", origin: "external-agent", kind: "update-parameters", summary: "Update parameters", undoable: true },
          { commandId: "history-system", timestamp: "2026-07-17T00:00:03Z", origin: "system", kind: "set-mcp-permission", summary: "Consume allow-once", undoable: false },
          { commandId: "history-user-2", timestamp: "2026-07-17T00:00:04Z", origin: "user", kind: "edit-document", summary: "Edit main.scad", undoable: true },
        ]}
        historyDetails={new Map([
          ["history-user", { kind: "source-diff", path: "main.scad", before: "cube(1);", after: "cube(2);" }],
          ["history-user-2", { kind: "source-diff", path: "main.scad", before: "cube(2);", after: "cube(3);" }],
        ])}
        pendingReviews={[{ commandId: "review-1", tool: "set_parameters", arguments: { path: "main.scad", values: { width: 24 } }, createdAt: "2026-07-17T00:00:00Z", origin: "external-agent" }]}
        sourceForPath={() => "cube(1);"}
        onApprove={approve}
        onDeny={deny}
      />,
    );

    expect(view.getByText("MCP parameter change: main.scad")).toBeVisible();
    expect(view.getAllByText("User")).toHaveLength(2);
    expect(view.getByText("AI panel")).toBeVisible();
    expect(view.getByText("External agent")).toBeVisible();
    expect(view.getByText("System")).toBeVisible();
    const detailButtons = view.getAllByRole("button", { name: /^View command detail:/u });
    expect(detailButtons.map((button) => button.textContent)).toEqual([
      "UserEdit main.scad2026-07-17T00:00:04Z",
      "SystemConsume allow-once2026-07-17T00:00:03Z",
      "External agentUpdate parameters2026-07-17T00:00:02Z",
      "AI panelApply AI edit2026-07-17T00:00:01Z",
      "UserEdit main.scad2026-07-17T00:00:00Z",
    ]);
    expect(detailButtons[0]).toHaveAccessibleName(
      "View command detail: Edit main.scad — User — 2026-07-17T00:00:04Z",
    );
    expect(detailButtons[4]).toHaveAccessibleName(
      "View command detail: Edit main.scad — User — 2026-07-17T00:00:00Z",
    );
    fireEvent.click(detailButtons[4]);
    expect(view.getByRole("article", { name: "Command detail" })).toHaveTextContent("edit-document");
    expect(view.getByRole("region", { name: "main.scad" })).toHaveTextContent("cube(1);");
    expect(view.getByRole("region", { name: "main.scad" })).toHaveTextContent("cube(2);");
    fireEvent.click(detailButtons[0]);
    expect(view.getByRole("region", { name: "main.scad" })).toHaveTextContent("cube(3);");
    fireEvent.click(view.getByRole("button", { name: "Approve change" }));
    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    fireEvent.click(view.getByRole("button", { name: "Deny change" }));
    expect(deny).toHaveBeenCalledWith("review-1");
    expect(view.getByRole("region", { name: "Workspace history" })).toBeVisible();
    expect(view.getByRole("heading", { name: "Workspace history", level: 2 })).toBeVisible();
    expect(view.getByRole("region", { name: "Pending tool reviews" })).toBeVisible();
  });
});
