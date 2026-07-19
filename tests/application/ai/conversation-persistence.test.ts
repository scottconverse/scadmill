import { describe, expect, it, vi } from "vitest";
import { createAgentLoop, requestAgentRound } from "../../../src/application/ai/agent-loop";
import { conversationReducer, createConversationState } from "../../../src/application/ai/conversation";
import { createLocalConversationPersistence, deserializeConversation, loadConversation, saveConversation, serializeConversation } from "../../../src/application/ai/conversation-persistence";

describe("AI conversation persistence and agent caps", () => {
  it("uses the opaque project identity as the conversation boundary", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    };
    const first = createLocalConversationPersistence("workspace:/one", storage);
    const sameProjectOtherTab = createLocalConversationPersistence("workspace:/one", storage);
    const otherProject = createLocalConversationPersistence("workspace:/two", storage);
    first.save("project-one");
    expect(sameProjectOtherTab.load()).toBe("project-one");
    expect(otherProject.load()).toBeNull();
  });
  it("round-trips review state while redacting the provider secret", () => {
    let state = conversationReducer(createConversationState(), { kind: "user-message", message: { id: "u1", role: "user", content: "hello sk-secret", streaming: false } });
    state = conversationReducer(state, { kind: "select-configuration", configurationId: "profile-review" });
    state = conversationReducer(state, { kind: "propose-edit", proposal: { id: "p1", messageId: "u1", documentId: "d1", code: "cube(1); sk-secret", language: "scad", status: "pending" } });
    const persistence = { load: () => null, save: vi.fn(), clear: vi.fn() };
    saveConversation(persistence, state, "sk-secret");
    expect(persistence.save).toHaveBeenCalledOnce();
    const serialized = persistence.save.mock.calls[0]?.[0] as string;
    expect(serialized).not.toContain("sk-secret");
    const restored = loadConversation({ ...persistence, load: () => serialized });
    expect(restored.configurationId).toBe("profile-review");
    expect(restored).toMatchObject({ messages: [{ content: "hello [redacted]" }], proposals: [{ code: "cube(1); [redacted]" }] });
  });

  it("fails closed on malformed or oversized persisted data", () => {
    expect(deserializeConversation("not json").messages).toHaveLength(0);
    expect(deserializeConversation(JSON.stringify({ schemaVersion: 1, messages: [{ id: "x", role: "user", content: "x".repeat(70_000) }] })).messages).toHaveLength(0);
  });

  it("round-trips the stable id for a maximum-size Unicode model name", () => {
    const configurationId = `model-${"ff".repeat(2_048)}`;
    let state = createConversationState();
    state = conversationReducer(state, { kind: "select-configuration", configurationId });

    expect(deserializeConversation(serializeConversation(state, [])).configurationId).toBe(configurationId);
  });

  it("stores conversations under a document-scoped key and supports deletion", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) };
    const persistence = createLocalConversationPersistence("doc-1", storage);
    persistence.save(JSON.stringify({ schemaVersion: 1, messages: [], proposals: [] }));
    expect(persistence.load()).toContain("schemaVersion");
    expect(values.size).toBe(1);
    persistence.clear();
    expect(persistence.load()).toBeNull();
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
