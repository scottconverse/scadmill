// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiConversationPanel } from "../../../src/ui/ai/AiConversationPanel";

async function* stream() {
  yield "```scad\n";
  yield "cube(10);\n```";
}

describe("AiConversationPanel", () => {
  it("sends the fixed OpenSCAD system prompt and exposes copy/insert actions", async () => {
    const requests: unknown[] = [];
    const onCopy = vi.fn(async () => undefined);
    const onInsertAtCursor = vi.fn();
    async function* reply() { yield "```scad\ncube(2);\n```"; }
    render(<AiConversationPanel configured currentSource="cube(1);" documentId="d1" model="test-model" onCopy={onCopy} onInsertAtCursor={onInsertAtCursor} requestStream={(messages) => { requests.push(messages); return reply(); }} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "make it bigger" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("test-model", { exact: false })).toBeVisible();
    expect((requests[0] as Array<{ role: string; content: string }>)[0]).toMatchObject({ role: "system", content: expect.stringContaining("OpenSCAD") });
    const copyButtons = await screen.findAllByRole("button", { name: "Copy" });
    fireEvent.click(copyButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: "Insert at cursor" }));
    expect(onCopy).toHaveBeenCalled();
    expect(onInsertAtCursor).toHaveBeenCalledWith(expect.stringContaining("cube(2);"));
  });

  it("streams a reply and exposes a reviewable apply action", async () => {
    const onApplyEdit = vi.fn();
    render(<AiConversationPanel configured currentSource="cube(5);" documentId="d1" requestStream={() => stream()} onApplyEdit={onApplyEdit} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "make a cube" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("cube(10);", { exact: false })).toBeVisible();
    fireEvent.click(screen.getByText("Inline", { exact: true }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use disk change" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Apply hunk choices" }));
    expect(onApplyEdit).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByText("accepted")).toBeVisible());
  });

  it("keeps the setup copy and no send control when unconfigured", () => {
    render(<AiConversationPanel configured={false} currentSource="" documentId="d1" />);
    expect(screen.getByText("AI is not configured.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });
});
