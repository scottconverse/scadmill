import { describe, expect, it } from "vitest";

import {
  conversationReducer,
  createConversationState,
  extractCodeBlocks,
} from "../../../src/application/ai/conversation";

describe("AI conversation reducer", () => {
  it("extracts OpenSCAD and unlabeled fenced blocks without consuming prose", () => {
    expect(extractCodeBlocks("before\n```scad\ncube(10);\n```\nafter\n```\n sphere(2);\n```"))
      .toEqual([{ language: "scad", code: "cube(10);\n" }, { language: "", code: " sphere(2);\n" }]);
  });

  it("accumulates only the active streamed assistant request", () => {
    let state = createConversationState();
    state = conversationReducer(state, { kind: "assistant-start", requestId: "r1", messageId: "m1" });
    state = conversationReducer(state, { kind: "assistant-delta", requestId: "stale", content: "bad" });
    state = conversationReducer(state, { kind: "assistant-delta", requestId: "r1", content: "good" });
    state = conversationReducer(state, { kind: "assistant-complete", requestId: "r1" });
    expect(state.messages).toEqual([{ id: "m1", role: "assistant", content: "good", streaming: false }]);
    expect(state.activeRequestId).toBeNull();
  });

  it("keeps edits reviewable until explicitly accepted or rejected", () => {
    let state = createConversationState();
    state = conversationReducer(state, { kind: "propose-edit", proposal: { id: "p1", messageId: "m1", documentId: "d1", code: "cube(10);", language: "scad", status: "accepted" } });
    expect(state.proposals[0]?.status).toBe("pending");
    state = conversationReducer(state, { kind: "review-edit", proposalId: "p1", status: "accepted" });
    expect(state.proposals[0]?.status).toBe("accepted");
    state = conversationReducer(state, { kind: "review-edit", proposalId: "missing", status: "rejected" });
    expect(state.proposals[0]?.status).toBe("accepted");
  });
});
