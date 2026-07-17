import { describe, expect, it, vi } from "vitest";
import type { WorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime-contracts";
import type { PersistedSettings } from "../../../src/application/settings/settings-schema";
import { createAiConversationBridge } from "../../../src/ui/ai/ai-runtime-bridge";

const settings = { ai: { provider: "openai", endpoint: "https://example.test", model: "test", persistWebSecret: false } } as PersistedSettings;

describe("AI runtime bridge", () => {
  it("dispatches only an accepted proposal for the active document", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const runtime = { dispatch } as unknown as WorkbenchRuntime;
    const bridge = createAiConversationBridge(runtime, settings, { load: async () => "secret", persistence: "web-session", save: async () => undefined, clear: async () => undefined }, "d1");
    bridge.applyEdit({ id: "p", messageId: "m", documentId: "other", code: "bad", language: "scad", status: "accepted" });
    bridge.applyEdit({ id: "p2", messageId: "m", documentId: "d1", code: "cube(9);", language: "scad", status: "accepted" });
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ kind: "edit-document", origin: "ai-panel", documentId: "d1", source: "cube(9);" });
  });
});
