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
    const fetchImpl = createTauriAiFetchFactory(
      vi.fn().mockResolvedValue(undefined),
      (onmessage) => ({ onmessage }),
      5,
    )();

    await expect(fetchImpl("https://provider.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    })).rejects.toThrow("terminal");
  });

  it("allows channel delivery queued just after the backend command resolves", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const channel = args?.onEvent as { onmessage?: (event: unknown) => void };
      setTimeout(() => {
        channel.onmessage?.({ kind: "start", status: 200, headers: [] });
        channel.onmessage?.({ kind: "chunk", bytesBase64: "Y3ViZSgxKTs=" });
        channel.onmessage?.({ kind: "end" });
      }, 5);
    });
    const fetchImpl = createTauriAiFetchFactory(invoke, (onmessage) => ({ onmessage }), 100)();

    const response = await fetchImpl("https://provider.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });

    await expect(response.text()).resolves.toBe("cube(1);");
  });

  it("fails closed with a clear contract error for incorrectly cased chunk fields", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const channel = args?.onEvent as { onmessage?: (event: unknown) => void };
      channel.onmessage?.({ kind: "start", status: 200, headers: [] });
      channel.onmessage?.({ kind: "chunk", bytes_base64: "Y3ViZSgxMCk7" });
    });
    const fetchImpl = createTauriAiFetchFactory(invoke, (onmessage) => ({ onmessage }), 5)();

    const response = await fetchImpl("https://provider.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });

    await expect(response.text()).rejects.toThrow("bytesBase64");
  });

  it("rejects an unknown event kind instead of accepting a truncated response", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const channel = args?.onEvent as { onmessage?: (event: unknown) => void };
      channel.onmessage?.({ kind: "start", status: 200, headers: [] });
      channel.onmessage?.({ kind: "chunk", bytesBase64: "Y3ViZSgxKTs=" });
      channel.onmessage?.({ kind: "unexpected-terminal" });
    });
    const fetchImpl = createTauriAiFetchFactory(invoke, (onmessage) => ({ onmessage }), 5)();

    const response = await fetchImpl("https://provider.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });

    await expect(response.text()).rejects.toThrow("unsupported event kind");
  });

  it.each([
    { label: "non-numeric status", event: { kind: "start", status: "200", headers: [] } },
    { label: "non-array headers", event: { kind: "start", status: 200, headers: {} } },
    { label: "malformed header tuple", event: { kind: "start", status: 200, headers: [["content-type"]] } },
  ])("rejects a malformed start event with $label", async ({ event }) => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      const channel = args?.onEvent as { onmessage?: (event: unknown) => void };
      channel.onmessage?.(event);
    });
    const fetchImpl = createTauriAiFetchFactory(invoke, (onmessage) => ({ onmessage }), 5)();

    await expect(fetchImpl("https://provider.test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    })).rejects.toThrow("start event");
  });
});
