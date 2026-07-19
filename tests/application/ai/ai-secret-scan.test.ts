import { describe, expect, it, vi } from "vitest";

import { requestAiCompletion } from "../../../src/application/ai/ai-client";
import { conversationReducer, createConversationState } from "../../../src/application/ai/conversation";
import { saveConversation } from "../../../src/application/ai/conversation-persistence";
import { createDefaultPersistedSettings, serializePersistedSettings } from "../../../src/application/settings/settings-codec";

describe("AC-10.d AI secret surface scan", () => {
  it("keeps the exact configured key out of console calls and persisted settings/conversation bytes", async () => {
    const sentinel = "AC-10.d-SENTINEL-PROVIDER-KEY";
    const consoleCalls: string[] = [];
    const spies = (["log", "warn", "error"] as const).map((method) => vi.spyOn(console, method).mockImplementation((...values) => {
      consoleCalls.push(JSON.stringify(values));
    }));
    let persistedConversation = "";
    try {
      let state = createConversationState();
      state = conversationReducer(state, {
        kind: "user-message",
        message: { id: "u1", role: "user", content: `do not retain ${sentinel}`, streaming: false },
      });
      saveConversation({ load: () => null, save: (value) => { persistedConversation = value; }, clear: () => undefined }, state, sentinel);
      const persistedSettings = serializePersistedSettings(createDefaultPersistedSettings());
      const providerFailure = requestAiCompletion(
        { provider: "openai", endpoint: "https://example.test", model: "test", models: ["test"], configurations: [], persistWebSecret: false },
        { load: () => sentinel },
        { model: "test", messages: [{ role: "user", content: "hello" }] },
        new AbortController().signal,
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: `rejected ${sentinel}` } }), { status: 401 })),
      );

      await expect(providerFailure).rejects.toThrow("rejected [redacted]");
      expect(JSON.stringify({ consoleCalls, persistedConversation, persistedSettings })).not.toContain(sentinel);
      expect(persistedConversation).toContain("[redacted]");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
