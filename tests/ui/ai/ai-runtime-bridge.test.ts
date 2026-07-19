import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime-contracts";
import type { PersistedSettings } from "../../../src/application/settings/settings-schema";
import { createAiConversationBridge } from "../../../src/ui/ai/ai-runtime-bridge";

const settings = { ai: { provider: "openai", endpoint: "https://example.test", model: "test", models: ["test"], configurations: [], persistWebSecret: false } } as unknown as PersistedSettings;

describe("AI runtime bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispatches only an accepted proposal for the active document", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const runtime = { dispatch, documents: { getState: () => ({ documents: [{ id: "d1" }], activeDocumentId: "d1", recentlyClosed: [] }) } } as unknown as WorkbenchRuntime;
    const bridge = createAiConversationBridge(runtime, settings, { load: async () => "secret", persistence: "web-session", save: async () => undefined, clear: async () => undefined });
    await expect(bridge.applyEdit({ id: "p", messageId: "m", documentId: "other", code: "bad", language: "scad", status: "accepted" })).rejects.toThrow("original document is no longer open");
    await bridge.applyEdit({ id: "p2", messageId: "m", documentId: "d1", code: "cube(9);", language: "scad", status: "accepted" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({ kind: "edit-document", origin: "ai-panel", documentId: "d1", source: "cube(9);" });
  });

  it("reports runtime dispatch rejection instead of claiming an edit applied", async () => {
    const runtime = {
      dispatch: vi.fn().mockRejectedValue(new Error("write failed")),
      documents: { getState: () => ({ documents: [{ id: "d1" }], activeDocumentId: "d1", recentlyClosed: [] }) },
    } as unknown as WorkbenchRuntime;
    const bridge = createAiConversationBridge(runtime, settings, { load: async () => "secret", persistence: "web-session", save: async () => undefined, clear: async () => undefined });

    await expect(bridge.applyEdit({ id: "p", messageId: "m", documentId: "d1", code: "cube(9);", language: "scad", status: "pending" })).rejects.toThrow("write failed");
  });

  it("routes a selected provider/model profile through its scoped secret and endpoint", async () => {
    const profileSettings = {
      ...settings,
      ai: {
        ...settings.ai,
        provider: "none" as const,
        model: "",
        models: [],
        configurations: [{
          id: "reviewer",
          label: "Review model",
          provider: "compatible" as const,
          endpoint: "https://profile.example.test/v1/chat/completions",
          model: "profile-model",
        }],
      },
    };
    const load = vi.fn(async (_persist: boolean, scope?: string) => scope === "reviewer" ? "profile-secret" : "");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"profile reply"}}]}\n\ndata: [DONE]\n\n',
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const runtime = { dispatch: vi.fn(), documents: { getState: () => ({ documents: [], activeDocumentId: null, recentlyClosed: [] }) } } as unknown as WorkbenchRuntime;
    const bridge = createAiConversationBridge(runtime, profileSettings, { load, persistence: "web-session", save: async () => undefined, clear: async () => undefined });

    expect(bridge.configurations).toEqual([{ id: "profile-reviewer", label: "Review model — compatible — profile-model" }]);
    const chunks: string[] = [];
    for await (const chunk of bridge.requestStream([{ role: "user", content: "review" }], new AbortController().signal, "profile-reviewer")) chunks.push(chunk);

    expect(chunks).toEqual(["profile reply"]);
    expect(load).toHaveBeenCalledWith(false, "reviewer");
    expect(fetchMock).toHaveBeenCalledWith("https://profile.example.test/v1/chat/completions", expect.objectContaining({
      body: expect.stringContaining('"model":"profile-model"'),
      headers: expect.objectContaining({ authorization: "Bearer profile-secret" }),
    }));
  });

  it("keeps a persisted legacy-model selection stable when the display order changes", () => {
    const secretStore = { load: async () => "secret", persistence: "web-session" as const, save: async () => undefined, clear: async () => undefined };
    const runtime = { dispatch: vi.fn(), documents: { getState: () => ({ documents: [], activeDocumentId: null, recentlyClosed: [] }) } } as unknown as WorkbenchRuntime;
    const before = createAiConversationBridge(runtime, {
      ...settings,
      ai: { ...settings.ai, model: "primary", models: ["model-b", "model-c"] },
    }, secretStore).configurations;
    const after = createAiConversationBridge(runtime, {
      ...settings,
      ai: { ...settings.ai, model: "primary", models: ["model-c", "model-b"] },
    }, secretStore).configurations;
    const persistedId = before.find(({ label }) => label.endsWith("model-b"))?.id;

    expect(persistedId).toBeTruthy();
    expect(after.find(({ id }) => id === persistedId)?.label).toBe("openai — model-b");
  });

  it("disambiguates duplicate profile names with provider and model", () => {
    const runtime = { dispatch: vi.fn(), documents: { getState: () => ({ documents: [], activeDocumentId: null, recentlyClosed: [] }) } } as unknown as WorkbenchRuntime;
    const bridge = createAiConversationBridge(runtime, {
      ...settings,
      ai: {
        ...settings.ai,
        provider: "none",
        model: "",
        models: [],
        configurations: [
          { id: "one", label: "Review", provider: "openai", endpoint: "https://one.test", model: "model-a" },
          { id: "two", label: "Review", provider: "anthropic", endpoint: "https://two.test", model: "model-b" },
        ],
      },
    }, { load: async () => "", persistence: "web-session", save: async () => undefined, clear: async () => undefined });

    expect(bridge.configurations.map(({ label }) => label)).toEqual([
      "Review — openai — model-a",
      "Review — anthropic — model-b",
    ]);
  });

  it("gives distinct stable ids to distinct lone-surrogate model strings", () => {
    const runtime = { dispatch: vi.fn(), documents: { getState: () => ({ documents: [], activeDocumentId: null, recentlyClosed: [] }) } } as unknown as WorkbenchRuntime;
    const bridge = createAiConversationBridge(runtime, {
      ...settings,
      ai: { ...settings.ai, model: "\uD800", models: ["\uD801"] },
    }, { load: async () => "", persistence: "web-session", save: async () => undefined, clear: async () => undefined });

    expect(new Set(bridge.configurations.map(({ id }) => id)).size).toBe(2);
  });
});
