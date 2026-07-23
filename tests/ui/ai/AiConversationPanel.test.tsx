// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationPersistence } from "../../../src/application/ai/conversation-persistence";
import { AiConversationPanel } from "../../../src/ui/ai/AiConversationPanel";

async function* stream() {
  yield "```scad\n";
  yield "cube(10);\n```";
}

describe("AiConversationPanel", () => {
  it("commits native textarea input events before sending", async () => {
    const requests: Array<readonly { role: string; content: string }[]> = [];
    async function* reply() { yield "ready"; }
    render(<AiConversationPanel
      configured
      currentSource="cube(1);"
      documentId="d1"
      requestStream={(messages) => {
        requests.push(messages);
        return reply();
      }}
    />);

    fireEvent.input(screen.getByLabelText("Message"), { target: { value: "native editing input" } });
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    expect(await screen.findByText("ready")).toBeVisible();
    expect(requests[0].at(-1)).toEqual({ role: "user", content: "native editing input" });
  });

  it("uses the settled context-toggle values for the next request", async () => {
    const requests: Array<readonly { role: string; content: string }[]> = [];
    async function* reply() { yield "ready"; }
    const panel = (source: string) => <AiConversationPanel
      configured
      contextInputs={{
        source,
        diagnostics: ["WARNING: context diagnostic"],
        parameters: ["width = 41"],
        screenshotDataUrl: "data:image/png;base64,AQID",
      }}
      currentSource={source}
      documentId="d1"
      requestStream={(messages) => {
        requests.push(messages);
        return reply();
      }}
    />;
    const view = render(panel("cube(41);"));

    for (const label of ["Current file", "Diagnostics", "Parameters"]) {
      const checkbox = screen.getByLabelText(label);
      expect(checkbox).toBeChecked();
      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
    }
    view.rerender(panel("cube(42);"));
    for (const label of ["Current file", "Diagnostics", "Parameters"]) {
      expect(screen.getByLabelText(label)).not.toBeChecked();
    }
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "without context" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("ready")).toBeVisible();
    const requestText = requests[0].map(({ content }) => content).join("\n");
    expect(requestText).not.toContain("<current-file>");
    expect(requestText).not.toContain("<diagnostics>");
    expect(requestText).not.toContain("<parameters>");
    expect(requestText).not.toContain("<viewer-screenshot>");
  });

  it("sends the fixed OpenSCAD system prompt and exposes copy/insert actions", async () => {
    const requests: unknown[] = [];
    const onCopy = vi.fn(async () => undefined);
    const onInsertAtCursor = vi.fn();
    async function* reply() { yield "```scad\ncube(2);\n```"; }
    render(<AiConversationPanel configurations={[{ id: "default", label: "test-model" }]} configured currentSource="cube(1);" documentId="d1" onCopy={onCopy} onInsertAtCursor={onInsertAtCursor} requestStream={(messages) => { requests.push(messages); return reply(); }} />);
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

  it("selects a user-configured model for this conversation and sends that exact model", async () => {
    const requestedModels: Array<string | undefined> = [];
    async function* reply() { yield "ready"; }
    render(<AiConversationPanel configurations={[{ id: "a", label: "OpenAI — model-a" }, { id: "b", label: "Anthropic — model-b" }]} configured currentSource="cube(1);" documentId="d1" requestStream={(_messages, _signal, selectedModel) => { requestedModels.push(selectedModel); return reply(); }} />);
    fireEvent.change(screen.getByLabelText("Conversation model"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "use the selected model" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("ready")).toBeVisible();
    expect(requestedModels).toEqual(["b"]);
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

  it("keeps the setup copy, opens settings, and has no send control when unconfigured", () => {
    const onOpenSettings = vi.fn();
    render(<AiConversationPanel configured={false} currentSource="" documentId="d1" onOpenSettings={onOpenSettings} />);
    expect(screen.getByText("AI is not configured.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("redacts the loaded provider key from every persisted conversation snapshot", async () => {
    const snapshots: string[] = [];
    const persistence: ConversationPersistence = {
      load: () => null,
      save: (serialized) => snapshots.push(serialized),
      clear: vi.fn(),
    };
    async function* echoSecret() { yield "ordinary-provider-password"; }
    render(
      <AiConversationPanel
        configured
        configurations={[{ id: "default", label: "test" }]}
        currentSource="cube(1);"
        documentId="d1"
        loadConfigurationSecret={async () => "ordinary-provider-password"}
        loadPersistenceSecrets={async () => ["ordinary-provider-password"]}
        persistence={persistence}
        requestStream={() => echoSecret()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "repeat ordinary-provider-password" } });
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await screen.findByText("ordinary-provider-password");
    await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
    expect(snapshots.join("\n")).not.toContain("ordinary-provider-password");
    expect(snapshots.join("\n")).toContain("[redacted]");
  });

  it("reloads a rotated provider key before every persistence transaction", async () => {
    let currentSecret = "old-provider-key";
    const snapshots: string[] = [];
    const persistence: ConversationPersistence = { load: () => null, save: (value) => snapshots.push(value), clear: vi.fn() };
    async function* echoCurrentSecret() { yield currentSecret; }
    render(<AiConversationPanel
      configured currentSource="cube(1);" documentId="d1"
      configurations={[{ id: "default", label: "test" }]}
      loadConfigurationSecret={async () => currentSecret}
      loadPersistenceSecrets={async () => [currentSecret]}
      persistence={persistence}
      requestStream={() => echoCurrentSecret()}
    />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
    currentSecret = "replacement-provider-key";
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "repeat replacement-provider-key" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("replacement-provider-key");
    await waitFor(() => expect(snapshots.join("\n")).toContain("[redacted]"));
    expect(snapshots.join("\n")).not.toContain("replacement-provider-key");
  });

  it("loads persistence secrets only at durable boundaries while a reply streams", async () => {
    const loadPersistenceSecrets = vi.fn().mockResolvedValue(["provider-key"]);
    async function* manyChunks() {
      for (let index = 0; index < 50; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield "x";
      }
    }
    render(<AiConversationPanel
      configurations={[{ id: "local", label: "local" }]}
      configurationRequiresSecret={() => false}
      configured
      currentSource="cube(1);"
      documentId="d1"
      loadConfigurationSecret={async () => null}
      loadPersistenceSecrets={loadPersistenceSecrets}
      requestStream={() => manyChunks()}
    />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "stream" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("x".repeat(50))).toBeVisible();
    await waitFor(() => expect(loadPersistenceSecrets).toHaveBeenCalled());
    expect(loadPersistenceSecrets.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("keeps a project conversation proposal bound to its originating document after a tab switch", async () => {
    const onApplyEdit = vi.fn();
    const sourceForDocument = (documentId: string) => documentId === "d1" ? "cube(1);" : "sphere(2);";
    const view = render(<AiConversationPanel configured currentSource="cube(1);" documentId="d1" onApplyEdit={onApplyEdit} requestStream={() => stream()} sourceForDocument={sourceForDocument} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "change document A" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("cube(10);", { exact: false })).toBeVisible();
    view.rerender(<AiConversationPanel configured currentSource="sphere(2);" documentId="d2" onApplyEdit={onApplyEdit} requestStream={() => stream()} sourceForDocument={sourceForDocument} />);
    expect(screen.getByRole("textbox", { name: "Your version" })).toHaveTextContent("cube(1);");
    expect(screen.getByRole("textbox", { name: "Your version" })).not.toHaveTextContent("sphere(2);");
    fireEvent.click(screen.getByText("Inline", { exact: true }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use disk change" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Apply hunk choices" }));
    expect(onApplyEdit).toHaveBeenCalledWith(expect.objectContaining({ documentId: "d1", code: "cube(10);\n" }));
  });

  it("keeps a proposal pending and reports an edit-application failure", async () => {
    const onApplyEdit = vi.fn().mockRejectedValue(new Error("The proposal target is closed."));
    render(<AiConversationPanel configured currentSource="cube(1);" documentId="d1" onApplyEdit={onApplyEdit} requestStream={() => stream()} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "change it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("cube(10);");
    fireEvent.click(screen.getByText("Inline", { exact: true }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Use disk change" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Apply hunk choices" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The proposal target is closed.");
    expect(screen.getByText("Inline", { exact: true })).toBeVisible();
    expect(screen.queryByText("accepted", { exact: true })).not.toBeInTheDocument();
  });

  it("surfaces fail-closed conversation persistence when secrets cannot be loaded", async () => {
    render(<AiConversationPanel
      configurations={[{ id: "local", label: "local" }]}
      configurationRequiresSecret={() => false}
      configured
      currentSource="cube(1);"
      documentId="d1"
      loadConfigurationSecret={async () => null}
      loadPersistenceSecrets={async () => { throw new Error("keychain unavailable"); }}
      requestStream={() => stream()}
    />);

    expect(await screen.findByRole("alert")).toHaveTextContent("project conversation could not be saved");
  });

  it("fails closed when an authenticated provider has no stored key", async () => {
    render(<AiConversationPanel configurations={[{ id: "default", label: "test" }]} configured currentSource="cube(1);" documentId="d1" loadConfigurationSecret={async () => null} loadPersistenceSecrets={async () => []} requestStream={() => stream()} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } });
    expect(await screen.findByText("Save an AI provider key in Settings before sending a message.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("clears a stale missing-key alert after selecting a ready configuration", async () => {
    render(<AiConversationPanel
      configurations={[{ id: "remote", label: "remote" }, { id: "local", label: "local" }]}
      configurationRequiresSecret={(id) => id === "remote"}
      configured
      currentSource="cube(1);"
      documentId="d1"
      loadConfigurationSecret={async () => null}
      loadPersistenceSecrets={async () => []}
      requestStream={() => stream()}
    />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Save an AI provider key");

    fireEvent.change(screen.getByLabelText("Conversation model"), { target: { value: "local" } });

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("runs the opt-in scripted agent through render, diagnostics, and a reviewable edit", async () => {
    const requestAgentTurn = vi.fn()
      .mockResolvedValueOnce({ toolCall: { name: "render_preview", arguments: { path: "main.scad" } } })
      .mockResolvedValueOnce({ toolCall: { name: "get_diagnostics", arguments: { path: "main.scad" } } })
      .mockResolvedValueOnce({ toolCall: { name: "write_file", arguments: { path: "main.scad", content: "cube(9);" } } })
      .mockResolvedValueOnce({ text: "A reviewable fix is ready." });
    const call = vi.fn(async (name: string) => name === "write_file"
      ? { status: "pending_review", commandId: "review-ai" }
      : name === "render_preview"
        ? { diagnostics: [{ severity: "error", message: "broken" }] }
        : { diagnostics: [{ severity: "error", message: "broken" }] });
    render(<AiConversationPanel
      agentToolHandler={{ call }} configured currentSource="cube();" documentId="d1"
      requestAgentTurn={requestAgentTurn} requestStream={() => stream()}
    />);
    fireEvent.click(screen.getByLabelText("Allow tool calls for this conversation"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "repair the model" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("A reviewable fix is ready.")).toBeVisible();
    expect(call.mock.calls.map(([name]) => name)).toEqual(["render_preview", "get_diagnostics", "write_file"]);
    expect(screen.getByText("Agent status: completed")).toBeVisible();
  });

  it("separates streamed prose emitted by different agent rounds", async () => {
    const snapshots: string[] = [];
    let round = 0;
    const requestAgentTurn = vi.fn(async (_messages: readonly unknown[], _signal: AbortSignal, _model?: string, onTextDelta?: (delta: string) => void) => {
      round += 1;
      if (round === 1) {
        onTextDelta?.("First turn.");
        return { text: "First turn.", toolCall: { name: "get_diagnostics", arguments: {} } };
      }
      onTextDelta?.("Second turn.");
      return { text: "Second turn." };
    });
    render(<AiConversationPanel
      agentToolHandler={{ call: vi.fn().mockResolvedValue({ diagnostics: [] }) }}
      configured
      currentSource="cube(1);"
      documentId="d1"
      persistence={{ load: () => null, save: (value) => snapshots.push(value), clear: vi.fn() }}
      requestAgentTurn={requestAgentTurn}
      requestStream={() => stream()}
    />);
    fireEvent.click(screen.getByLabelText("Allow tool calls for this conversation"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "inspect" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Agent status: completed");

    await waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
    const persisted = JSON.parse(snapshots.at(-1) ?? "{}") as { messages?: Array<{ role: string; content: string }> };
    expect(persisted.messages?.find(({ role }) => role === "assistant")?.content).toBe("First turn.\n\nSecond turn.");
  });

  it("halts a looping agent at the configured cap and keeps auto-apply session-only", async () => {
    const requestAgentTurn = vi.fn(async () => ({ toolCall: { name: "get_diagnostics", arguments: {} } }));
    const call = vi.fn(async () => ({ diagnostics: [] }));
    render(<AiConversationPanel agentToolHandler={{ call }} configured currentSource="cube(1);" documentId="d1" requestAgentTurn={requestAgentTurn} requestStream={() => stream()} />);
    fireEvent.click(screen.getByLabelText("Allow tool calls for this conversation"));
    fireEvent.change(screen.getByLabelText("Maximum tool-call rounds"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Auto-apply proposed edits for this session"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "loop" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Agent status: capped")).toBeVisible());
    expect(call).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(screen.queryByLabelText("Auto-apply proposed edits for this session")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Allow tool calls for this conversation")).not.toBeChecked();
    expect(screen.queryByLabelText("Maximum tool-call rounds")).not.toBeInTheDocument();
  });

  it("aborts a pending agent tool when the conversation is cleared", async () => {
    let toolSignal: AbortSignal | undefined;
    const handler = { call: vi.fn((_name, _args, signal) => {
      toolSignal = signal;
      return new Promise(() => undefined);
    }) };
    render(<AiConversationPanel
      agentToolHandler={handler} configured currentSource="cube(1);" documentId="d1"
      requestAgentTurn={async () => ({ toolCall: { name: "render_preview", arguments: { path: "main.scad" } } })}
      requestStream={() => stream()}
    />);
    fireEvent.click(screen.getByLabelText("Allow tool calls for this conversation"));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "render" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(toolSignal).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(toolSignal?.aborted).toBe(true);
    expect(screen.getByLabelText("Allow tool calls for this conversation")).not.toBeChecked();
  });
});
