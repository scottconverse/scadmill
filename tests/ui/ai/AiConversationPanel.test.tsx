// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiConversationPanel } from "../../../src/ui/ai/AiConversationPanel";

async function* stream() {
  yield "```scad\n";
  yield "cube(10);\n```";
}

describe("AiConversationPanel", () => {
  it("streams a reply and exposes a reviewable apply action", async () => {
    const onApplyEdit = vi.fn();
    render(<AiConversationPanel configured documentId="d1" requestStream={() => stream()} onApplyEdit={onApplyEdit} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "make a cube" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const proposal = await screen.findByRole("button", { name: "Apply edit" });
    expect(within(proposal.parentElement as HTMLElement).getByText("cube(10);", { exact: false })).toBeVisible();
    fireEvent.click(proposal);
    expect(onApplyEdit).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("accepted")).toBeVisible());
  });

  it("keeps the setup copy and no send control when unconfigured", () => {
    render(<AiConversationPanel configured={false} documentId="d1" />);
    expect(screen.getByText("AI is not configured.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });
});
