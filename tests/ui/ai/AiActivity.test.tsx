// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { messages } from "../../../src/messages/en";
import { AiActivity } from "../../../src/ui/ai/AiActivity";

describe("AiActivity", () => {
  it("shows setup guidance and does not perform network work when unconfigured", () => {
    const openSettings = vi.fn();
    render(<AiActivity configured={false} onOpenSettings={openSettings} />);
    expect(screen.getByText(messages.aiNotConfigured)).toBeVisible();
    expect(screen.getByText(messages.aiSetupGuidance)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: messages.openSettings }));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
