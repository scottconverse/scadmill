import { describe, expect, it, vi } from "vitest";
import { createAgentLoop, requestAgentRound } from "../../../src/application/ai/agent-loop";
import { conversationReducer, createConversationState } from "../../../src/application/ai/conversation";
import { deserializeConversation, loadConversation, saveConversation } from "../../../src/application/ai/conversation-persistence";

describe("AI conversation persistence and agent caps", () => {
  it("round-trips review state while redacting the provider secret", () => {
    let state = conversationReducer(createConversationState(), { kind: "user-message", message: { id: "u1", role: "user", content: "hello sk-secret", streaming: false } });
    state = conversationReducer(state, { kind: "propose-edit", proposal: { id: "p1", messageId: "u1", documentId: "d1", code: "cube(1); sk-secret", language: "scad", status: "pending" } });
    const persistence = { load: () => null, save: vi.fn(), clear: vi.fn() };
    saveConversation(persistence, state, "sk-secret");
    expect(persistence.save).toHaveBeenCalledOnce();
    const serialized = persistence.save.mock.calls[0]?.[0] as string;
    expect(serialized).not.toContain("sk-secret");
    expect(loadConversation({ ...persistence, load: () => serialized })).toMatchObject({ messages: [{ content: "hello [redacted]" }], proposals: [{ code: "cube(1); [redacted]" }] });
  });

  it("fails closed on malformed or oversized persisted data", () => {
    expect(deserializeConversation("not json").messages).toHaveLength(0);
    expect(deserializeConversation(JSON.stringify({ schemaVersion: 1, messages: [{ id: "x", role: "user", content: "x".repeat(70_000) }] })).messages).toHaveLength(0);
  });

  it("halts an opted-in loop at the configured round cap", () => {
    let loop = createAgentLoop(true, 2);
    loop = requestAgentRound(loop);
    expect(loop.status).toBe("running");
    loop = requestAgentRound(loop);
    expect(loop).toMatchObject({ rounds: 2, status: "capped" });
    expect(requestAgentRound(loop)).toEqual(loop);
    expect(createAgentLoop(false).status).toBe("idle");
  });
});
