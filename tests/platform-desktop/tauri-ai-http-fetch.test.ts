import { describe, expect, it, vi } from "vitest";

import { createTauriAiFetchFactory } from "../../src/platform-desktop/tauri-ai-http-fetch";

describe("Tauri AI HTTP fetch", () => {
  it("streams status, headers, and byte chunks through the selected persisted configuration", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_http_request");
      const channel = args?.onEvent as { onmessage?: (event: unknown) => void };
      channel.onmessage?.({ kind: "start", status: 429, headers: [["content-type", "application/json"], ["x-test", "yes"]] });
      channel.onmessage?.({ kind: "chunk", bytesBase64: "eyJlcnJvciI6" });
      channel.onmessage?.({ kind: "chunk", bytesBase64: "InNsb3cgZG93biJ9" });
      channel.onmessage?.({ kind: "end" });
    });
    const fetchImpl = createTauriAiFetchFactory(invoke, (onmessage) => ({ onmessage }))("reviewer");

    const response = await fetchImpl("https://provider.test/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer secret" },
      body: "{}",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("x-test")).toBe("yes");
    await expect(response.text()).resolves.toBe('{"error":"slow down"}');
    expect(invoke).toHaveBeenCalledWith("ai_http_request", expect.objectContaining({
      request: expect.objectContaining({
        configurationId: "reviewer",
        endpoint: "https://provider.test/v1/chat/completions",
        method: "POST",
        body: "{}",
      }),
    }));
  });

  it("cancels the backend request when AbortSignal fires", async () => {
    let resolveRequest: () => void = () => undefined;
    const invoke = vi.fn((command: string) => command === "ai_http_request"
      ? new Promise<void>((resolve) => { resolveRequest = resolve; })
      : Promise.resolve());
    const fetchImpl = createTauriAiFetchFactory(invoke, (onmessage) => ({ onmessage }))();
    const abort = new AbortController();
    const pending = fetchImpl("https://provider.test/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: abort.signal,
    });

    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).toHaveBeenCalledWith("cancel_ai_http_request", expect.objectContaining({ requestId: expect.any(String) }));
    resolveRequest();
  });

  it("rejects non-POST and unsupported headers before invoking the backend", async () => {
    const invoke = vi.fn();
    const fetchImpl = createTauriAiFetchFactory(invoke, (onmessage) => ({ onmessage }))();

    await expect(fetchImpl("https://provider.test", { method: "GET" })).rejects.toThrow("POST");
    await expect(fetchImpl("https://provider.test", {
      method: "POST", headers: { cookie: "unsafe" }, body: "{}",
    })).rejects.toThrow("header");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a backend completion that omits the terminal response event", async () => {
    const fetchImpl = createTauriAiFetchFactory(vi.fn().mockResolvedValue(undefined), (onmessage) => ({ onmessage }))();

    await expect(fetchImpl("https://provider.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    })).rejects.toThrow("terminal");
  });
});
