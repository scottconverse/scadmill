import { describe, expect, it, vi } from "vitest";

import { requestAiAgentTurn, requestAiCompletion, streamAiAgentTurn, streamAiCompletion } from "../../../src/application/ai/ai-client";
import type { AiPreferences } from "../../../src/application/settings/settings-schema";

const base: AiPreferences = { provider: "openai", endpoint: "https://example.test/v1/chat/completions", model: "test", models: ["test"], configurations: [], persistWebSecret: false };
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

  it("allows an unauthenticated local Ollama endpoint without sending an authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "local reply" } }), { status: 200 }));
    await expect(requestAiCompletion(
      { ...base, provider: "local" },
      { load: () => null },
      request,
      new AbortController().signal,
      fetchImpl,
    )).resolves.toBe("local reply");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty("authorization");
  });

  it("surfaces a readable non-success response while redacting the exact configured secret", async () => {
    const arbitrarySecretStore = { load: () => "anthropic-secret-without-known-prefix" };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "credential anthropic-secret-without-known-prefix was rejected" },
    }), { status: 401 }));

    const failure = requestAiCompletion(
      { ...base, provider: "anthropic" },
      arbitrarySecretStore,
      request,
      new AbortController().signal,
      fetchImpl,
    );

    await expect(failure).rejects.toThrow("AI request failed (401): credential [redacted] was rejected");
  });

  it("redacts the exact configured key even when it has no recognizable prefix", async () => {
    const arbitrarySecretStore = { load: () => "ordinary-provider-password" };
    const fetchImpl = vi.fn().mockRejectedValue(new Error("x-api-key ordinary-provider-password leaked"));
    await expect(requestAiCompletion(
      { ...base, provider: "anthropic" },
      arbitrarySecretStore,
      request,
      new AbortController().signal,
      fetchImpl,
    )).rejects.toThrow("x-api-key [redacted] leaked");
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

  it("yields streamed OpenAI deltas and forwards cancellation", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(sink) {
        sink.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n'));
        sink.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'));
        sink.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const chunks: string[] = [];
    for await (const chunk of streamAiCompletion(base, secretStore, request, controller.signal, fetchImpl)) chunks.push(chunk);
    expect(chunks).toEqual(["hel", "lo"]);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({ stream: true });
  });

  it("decodes the official top-level Anthropic text-delta event", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(sink) {
      sink.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n'));
      sink.enqueue(encoder.encode('data: {"type":"message_stop"}\n'));
      sink.close();
    } });
    const chunks: string[] = [];
    for await (const chunk of streamAiCompletion(
      { ...base, provider: "anthropic" }, secretStore, request, new AbortController().signal,
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    )) chunks.push(chunk);

    expect(chunks).toEqual(["Hello"]);
  });

  it("throws a readable redacted error from an HTTP-200 provider stream event", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(sink) {
      sink.enqueue(encoder.encode('data: {"type":"error","error":{"type":"overloaded_error","message":"sk-secret-value overloaded"}}\n'));
      sink.close();
    } });
    const consume = async () => {
      for await (const _chunk of streamAiCompletion(
        { ...base, provider: "anthropic" }, secretStore, request, new AbortController().signal,
        vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
      )) { /* consume */ }
    };

    await expect(consume()).rejects.toThrow("AI stream failed: [redacted] overloaded");
  });

  it("yields streamed Ollama NDJSON deltas", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(sink) {
        sink.enqueue(encoder.encode('{"message":{"content":"hel"},"done":false}\n{"message":{"content":"lo"},'));
        sink.enqueue(encoder.encode('"done":false}\n{"message":{"content":""},"done":true}\n'));
        sink.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const chunks: string[] = [];

    for await (const chunk of streamAiCompletion(
      { ...base, provider: "local" },
      secretStore,
      request,
      new AbortController().signal,
      fetchImpl,
    )) chunks.push(chunk);

    expect(chunks).toEqual(["hel", "lo"]);
  });

  it.each(["openai", "compatible", "anthropic", "local"] as const)(
    "encodes screenshot context as a provider-native image for %s without dropping text context",
    async (provider) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(
        provider === "anthropic"
          ? { content: [{ text: "ok" }] }
          : provider === "local"
            ? { message: { content: "ok" } }
            : { choices: [{ message: { content: "ok" } }] },
      ), { status: 200 }));
      const messages = [
        { role: "system" as const, content: "fixed OpenSCAD prompt" },
        {
          role: "system" as const,
          content: "<current-file>\ncube(1);\n</current-file>\n\n<viewer-screenshot>\ndata:image/png;base64,AQID\n</viewer-screenshot>",
        },
        { role: "user" as const, content: "repair it" },
      ];

      await requestAiCompletion(
        { ...base, provider },
        secretStore,
        { model: "test", messages },
        new AbortController().signal,
        fetchImpl,
      );

      const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
        system?: string;
        messages: Array<{ role: string; content: unknown; images?: string[] }>;
      };
      const systemText = provider === "anthropic"
        ? body.system ?? ""
        : body.messages.filter(({ role }) => role === "system").map(({ content }) => String(content)).join("\n");
      expect(systemText).toContain("cube(1);");
      expect(systemText).not.toContain("viewer-screenshot");
      expect(systemText).not.toContain("data:image/png;base64,AQID");
      if (provider === "anthropic") {
        expect(body.system).toContain("fixed OpenSCAD prompt");
        expect(body.system).toContain("cube(1);");
        expect(body.messages.at(-1)?.content).toEqual([
          { type: "text", text: "repair it" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } },
        ]);
      } else if (provider === "local") {
        expect(body.messages.at(-1)).toMatchObject({ content: "repair it", images: ["AQID"] });
      } else {
        expect(body.messages.at(-1)?.content).toEqual([
          { type: "text", text: "repair it" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
        ]);
      }
    },
  );
});

describe("requestAiAgentTurn", () => {
  it.each([
    ["openai", { choices: [{ message: { content: "", tool_calls: [{ function: { name: "render_preview", arguments: '{"path":"main.scad"}' } }] } }] }],
    ["anthropic", { content: [{ type: "tool_use", name: "render_preview", input: { path: "main.scad" } }] }],
    ["local", { message: { content: "", tool_calls: [{ function: { name: "render_preview", arguments: { path: "main.scad" } } }] } }],
  ] as const)("decodes and advertises the bounded tool surface for %s", async (provider, responseBody) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));
    await expect(requestAiAgentTurn(
      { ...base, provider },
      secretStore,
      request,
      new AbortController().signal,
      fetchImpl,
    )).resolves.toEqual({ toolCall: { name: "render_preview", arguments: { path: "main.scad" } } });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { tools: Array<{ name?: string; function?: { name?: string } }> };
    expect(body.tools.map((tool) => tool.name ?? tool.function?.name)).toEqual([
      "read_file", "write_file", "render_preview", "get_diagnostics", "take_screenshot",
    ]);
  });

  it.each(["openai", "anthropic", "local"] as const)(
    "encodes a provider-correct tool continuation for %s",
    async (provider) => {
      const responseBody = provider === "anthropic"
        ? { content: [{ type: "text", text: "fixed" }] }
        : provider === "local"
          ? { message: { content: "fixed" } }
          : { choices: [{ message: { content: "fixed" } }] };
      const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody), { status: 200 }));
      await requestAiAgentTurn(
        { ...base, provider },
        secretStore,
        {
          model: "test",
          messages: [
            { role: "user", content: "render" },
            { role: "assistant", content: "", toolCall: { id: "call-7", name: "render_preview", arguments: { path: "main.scad" } } },
            { role: "tool", content: '{"diagnostics":[]}', toolCallId: "call-7", toolName: "render_preview" },
          ],
        },
        new AbortController().signal,
        fetchImpl,
      );
      const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as { messages: Array<Record<string, unknown>> };
      if (provider === "anthropic") {
        expect(body.messages).toEqual([
          { role: "user", content: "render" },
          { role: "assistant", content: [{ type: "tool_use", id: "call-7", name: "render_preview", input: { path: "main.scad" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call-7", content: '{"diagnostics":[]}' }] },
        ]);
      } else {
        expect(body.messages[1]).toMatchObject({
          role: "assistant",
          tool_calls: [{ id: "call-7", function: { name: "render_preview" } }],
        });
        expect(body.messages[2]).toMatchObject({ role: "tool", content: '{"diagnostics":[]}', tool_call_id: "call-7" });
      }
    },
  );
});

describe("streamAiAgentTurn", () => {
  it.each([
    ["openai", [
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\":\\"main"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":".scad\\"}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
    ]],
    ["anthropic", [
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"call-1","name":"read_file","input":{}}}',
      'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"main.scad\\"}"}}',
      'data: {"type":"message_stop"}',
    ]],
    ["local", [
      '{"message":{"content":"","tool_calls":[{"function":{"name":"read_file","arguments":{"path":"main.scad"}}}]},"done":true}',
    ]],
  ] as const)("streams and reconstructs a %s tool call", async (provider, lines) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(sink) { sink.enqueue(encoder.encode(`${lines.join("\n")}\n`)); sink.close(); } });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    const deltas: string[] = [];
    await expect(streamAiAgentTurn(
      { ...base, provider }, secretStore, request, new AbortController().signal,
      (delta) => deltas.push(delta), fetchImpl,
    )).resolves.toEqual({ toolCall: { ...(provider === "local" ? {} : { id: "call-1" }), name: "read_file", arguments: { path: "main.scad" } } });
    expect(deltas).toEqual([]);
  });

  it("delivers final agent text incrementally before completion", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(sink) {
      sink.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hel"}}]}\n'));
      sink.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n'));
      sink.close();
    } });
    const deltas: string[] = [];
    const result = await streamAiAgentTurn(base, secretStore, request, new AbortController().signal, (delta) => deltas.push(delta), vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    expect(deltas).toEqual(["hel", "lo"]);
    expect(result).toEqual({ text: "hello" });
  });

  it("throws a readable redacted error from an HTTP-200 agent stream event", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(sink) {
      sink.enqueue(encoder.encode('data: {"type":"error","error":{"message":"sk-secret-value overloaded"}}\n'));
      sink.close();
    } });

    await expect(streamAiAgentTurn(
      { ...base, provider: "anthropic" }, secretStore, request, new AbortController().signal,
      () => undefined, vi.fn().mockResolvedValue(new Response(stream, { status: 200 })),
    )).rejects.toThrow("AI stream failed: [redacted] overloaded");
  });
});
