import { describe, expect, it, vi } from "vitest";

import { requestAiCompletion } from "../../../src/application/ai/ai-client";
import type { AiPreferences } from "../../../src/application/settings/settings-schema";

const base: AiPreferences = { provider: "openai", endpoint: "https://example.test/v1/chat/completions", model: "test", persistWebSecret: false };
const secretStore = { load: () => "sk-secret-value" };
const request = { model: "test", messages: [{ role: "user" as const, content: "hello" }] };

describe("requestAiCompletion", () => {
  it("does not call fetch when no provider is configured", async () => {
    const fetchImpl = vi.fn();
    await expect(requestAiCompletion({ ...base, provider: "none" }, secretStore, request, new AbortController().signal, fetchImpl)).rejects.toThrow(/not configured/iu);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["openai", { choices: [{ message: { content: "openai reply" } }] }],
    ["compatible", { choices: [{ message: { content: "compatible reply" } }] }],
    ["anthropic", { content: [{ text: "anthropic reply" }] }],
    ["local", { message: { content: "local reply" } }],
  ] as const)("decodes the %s response shape", async (provider, responseBody) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));
    const content = await requestAiCompletion({ ...base, provider }, secretStore, request, new AbortController().signal, fetchImpl);
    expect(content).toContain("reply");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("redacts secret-like server errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Bearer sk-secret-value leaked"));
    await expect(requestAiCompletion(base, secretStore, request, new AbortController().signal, fetchImpl)).rejects.toThrow("[redacted]");
  });

  it("forwards the abort signal and provider wire headers", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    await requestAiCompletion(base, secretStore, request, controller.signal, fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).toMatchObject({ authorization: "Bearer sk-secret-value", "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test", messages: request.messages, stream: false });
  });
});
