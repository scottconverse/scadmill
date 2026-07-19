// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { McpToolHandler } from "../../../src/application/mcp/mcp-dispatcher";
import type { WorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime-contracts";
import { createDefaultPersistedSettings } from "../../../src/application/settings/settings-codec";
import type { SecretStore } from "../../../src/application/settings/secret-store";
import { AiWorkbenchPanel } from "../../../src/ui/ai/AiWorkbenchPanel";

describe("AiWorkbenchPanel", () => {
  it("enables a profile-only local provider when the legacy provider is none", async () => {
    const defaults = createDefaultPersistedSettings();
    const profile = {
      ...defaults,
      ai: {
        ...defaults.ai,
        configurations: [{
          id: "local-reviewer",
          label: "Local review model",
          provider: "local" as const,
          endpoint: "http://127.0.0.1:11434/api/chat",
          model: "qwen-review",
        }],
      },
    };
    const document = {
      id: "document-main",
      path: "main.scad",
      source: "cube(10);",
      revision: 0,
      savedRevision: 0,
      savedSource: "cube(10);",
    };
    const runtime = {
      dispatch: vi.fn().mockResolvedValue(undefined),
      documents: { getState: () => ({ documents: [document], activeDocumentId: document.id, recentlyClosed: [] }) },
    } as unknown as WorkbenchRuntime;
    const secretStore: SecretStore = {
      persistence: "web-session",
      load: vi.fn().mockResolvedValue(""),
      save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const agentToolHandler: McpToolHandler = { call: vi.fn().mockResolvedValue({}) };

    render(<AiWorkbenchPanel
      agentToolHandler={agentToolHandler}
      contextInputs={{ source: document.source, diagnostics: [], parameters: [] }}
      document={document}
      onApproveReview={vi.fn().mockResolvedValue(undefined)}
      onInsertAtCursor={vi.fn()}
      pendingReview={() => undefined}
      profile={profile}
      projectIdentity="workspace:/profile-only"
      runtime={runtime}
      secretStore={secretStore}
    />);

    expect(screen.getByRole("option", { name: "Local review model — local — qwen-review" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "review this" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(screen.queryByText("Configure an AI provider in Settings to start a conversation.")).not.toBeInTheDocument();
  });
});
