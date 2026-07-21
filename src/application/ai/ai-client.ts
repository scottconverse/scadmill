import type { AiPreferences } from "../settings/settings-schema";
import { MCP_TOOL_DEFINITIONS } from "../mcp/mcp-tools";
import type { AgentModelTurn, AgentToolCall } from "./agent-loop";
import { AI_AGENT_TOOL_NAMES } from "./agent-tool-executor";
import { type AiCompletionRequest, normalizeAiEndpoint } from "./ai-provider";

export interface AiSecretStore { load(scope: boolean): string | null; }
export type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type AiFetchFactory = (configurationId?: string) => AiFetch;

function redact(message: string, secret: string): Error {
  return new Error((secret ? message.split(secret).join("[redacted]") : message)
    .replace(/bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/gu, "[redacted]"));
}

interface ProviderImage {
  readonly data: string;
  readonly dataUrl: string;
  readonly mediaType: string;
}

const SCREENSHOT_CONTEXT = /(?:\r?\n){0,2}<viewer-screenshot>\s*(data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=]+))\s*<\/viewer-screenshot>/gu;

function extractProviderImage(messages: AiCompletionRequest["messages"]): {
  readonly image?: ProviderImage;
  readonly messages: AiCompletionRequest["messages"];
} {
  let image: ProviderImage | undefined;
  const cleaned = messages.flatMap((message) => {
    if (message.role !== "system") return [message];
    const content = message.content.replace(SCREENSHOT_CONTEXT, (_match, dataUrl: string, mediaType: string, data: string) => {
      image = { data, dataUrl, mediaType };
      return "";
    }).trim();
    return content ? [{ ...message, content }] : [];
  });
  return { image, messages: cleaned };
}

function withProviderImage(
  provider: AiPreferences["provider"],
  messages: AiCompletionRequest["messages"],
  image: ProviderImage | undefined,
): readonly unknown[] {
  const lastUserIndex = messages.findLastIndex(({ role }) => role === "user");
  return messages.map((message, index) => {
    if (!image || index !== lastUserIndex) return message;
    if (provider === "anthropic") {
      return { ...message, content: [
        { type: "text", text: message.content },
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
      ] };
    }
    if (provider === "local") return { ...message, images: [image.data] };
    return { ...message, content: [
      { type: "text", text: message.content },
      { type: "image_url", image_url: { url: image.dataUrl } },
    ] };
  });
}

function providerMessages(provider: AiPreferences["provider"], messages: readonly unknown[]): readonly unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message;
    const item = message as { role?: unknown; content?: unknown; toolCall?: { id?: string; name: string; arguments: Readonly<Record<string, unknown>> }; toolCallId?: string; toolName?: string };
    if (item.role === "assistant" && item.toolCall) {
      if (provider === "anthropic") return {
        role: "assistant",
        content: [
          ...(typeof item.content === "string" && item.content ? [{ type: "text", text: item.content }] : []),
          { type: "tool_use", id: item.toolCall.id, name: item.toolCall.name, input: item.toolCall.arguments },
        ],
      };
      return {
        role: "assistant",
        content: item.content || null,
        tool_calls: [{
          ...(item.toolCall.id ? { id: item.toolCall.id } : {}),
          type: "function",
          function: {
            name: item.toolCall.name,
            arguments: provider === "local" ? item.toolCall.arguments : JSON.stringify(item.toolCall.arguments),
          },
        }],
      };
    }
    if (item.role === "tool") {
      if (provider === "anthropic") return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: item.toolCallId, content: String(item.content ?? "") }],
      };
      return {
        role: "tool",
        content: String(item.content ?? ""),
        ...(item.toolCallId ? { tool_call_id: item.toolCallId } : {}),
        ...(provider === "local" && item.toolName ? { tool_name: item.toolName } : {}),
      };
    }
    return message;
  });
}

function requestEnvelope(preferences: AiPreferences, secret: string, request: AiCompletionRequest, stream: boolean) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const extracted = extractProviderImage(request.messages);
  const system = extracted.messages.filter(({ role }) => role === "system").map(({ content }) => content).join("\n\n");
  const messages = preferences.provider === "anthropic"
    ? extracted.messages.filter(({ role }) => role !== "system")
    : extracted.messages;
  const body: Record<string, unknown> = {
    model: request.model || preferences.model,
    messages: providerMessages(
      preferences.provider,
      withProviderImage(preferences.provider, messages, extracted.image),
    ),
    stream,
  };
  if (preferences.provider === "anthropic") {
    headers["x-api-key"] = secret;
    headers["anthropic-version"] = "2023-06-01";
    if (system) body.system = system;
    body.max_tokens = 4_096;
  } else if (preferences.provider !== "local" || secret) {
    headers.authorization = `Bearer ${secret}`;
  }
  return { headers, body };
}

function agentTools(provider: AiPreferences["provider"]): readonly Record<string, unknown>[] {
  const allowed = new Set<string>(AI_AGENT_TOOL_NAMES);
  return MCP_TOOL_DEFINITIONS.filter(({ name }) => allowed.has(name)).map(({ name, description, inputSchema }) => (
    provider === "anthropic"
      ? { name, description, input_schema: inputSchema }
      : { type: "function", function: { name, description, parameters: inputSchema } }
  ));
}

function toolArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return toolArguments(JSON.parse(value)); } catch { throw new Error("AI tool arguments were not valid JSON."); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI tool arguments must be an object.");
  }
  return value as Record<string, unknown>;
}

function decodeAgentTurn(provider: AiPreferences["provider"], parsed: unknown): AgentModelTurn {
  if (!parsed || typeof parsed !== "object") throw new Error("AI response did not contain an agent turn.");
  if (provider === "anthropic") {
    const blocks = (parsed as { content?: unknown }).content;
    if (!Array.isArray(blocks)) throw new Error("AI response did not contain an agent turn.");
    const text = blocks.flatMap((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string" ? [(block as { text: string }).text] : []).join("");
    const tool = blocks.find((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "tool_use") as { id?: unknown; name?: unknown; input?: unknown } | undefined;
    return { ...(text ? { text } : {}), ...(tool && typeof tool.name === "string" ? { toolCall: { ...(typeof tool.id === "string" ? { id: tool.id } : {}), name: tool.name, arguments: toolArguments(tool.input) } } : {}) };
  }
  const message = provider === "local"
    ? (parsed as { message?: unknown }).message
    : (parsed as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message;
  if (!message || typeof message !== "object") throw new Error("AI response did not contain an agent turn.");
  const item = message as { content?: unknown; tool_calls?: unknown };
  const calls = Array.isArray(item.tool_calls) ? item.tool_calls : [];
  const first = calls[0] as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | undefined;
  const toolCall: AgentToolCall | undefined = first?.function && typeof first.function.name === "string"
    ? { ...(typeof first.id === "string" ? { id: first.id } : {}), name: first.function.name, arguments: toolArguments(first.function.arguments) }
    : undefined;
  return {
    ...(typeof item.content === "string" && item.content ? { text: item.content } : {}),
    ...(toolCall ? { toolCall } : {}),
  };
}

export async function requestAiAgentTurn(
  preferences: AiPreferences,
  secretStore: AiSecretStore,
  request: AiCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AiFetch = globalThis.fetch,
): Promise<AgentModelTurn> {
  if (preferences.provider === "none") throw new Error("AI provider is not configured.");
  const secret = secretStore.load(preferences.persistWebSecret) ?? "";
  if (!secret && preferences.provider !== "local") throw new Error("AI provider secret is not configured.");
  const endpoint = normalizeAiEndpoint(preferences.provider, preferences.endpoint);
  const { headers, body } = requestEnvelope(preferences, secret, request, false);
  body.tools = agentTools(preferences.provider);
  let response: Response;
  try { response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (reason) { throw redact(reason instanceof Error ? reason.message : "AI request failed.", secret); }
  if (!response.ok) throw await failedResponse(response, secret);
  let parsed: unknown;
  try { parsed = await response.json(); } catch { throw new Error("AI response was not valid JSON."); }
  return decodeAgentTurn(preferences.provider, parsed);
}

interface AgentStreamState {
  text: string;
  toolId?: string;
  toolName?: string;
  toolArguments?: Record<string, unknown>;
  toolArgumentsJson: string;
}

function applyAgentStreamEvent(
  provider: AiPreferences["provider"],
  value: unknown,
  state: AgentStreamState,
  onTextDelta: (delta: string) => void,
): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  let delta = "";
  let done = false;
  if (provider === "anthropic") {
    const block = record.content_block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown } | undefined;
    const blockDelta = record.delta as { type?: unknown; text?: unknown; partial_json?: unknown } | undefined;
    if (record.type === "content_block_start" && block?.type === "tool_use") {
      if (typeof block.id === "string") state.toolId = block.id;
      if (typeof block.name === "string") state.toolName = block.name;
      if (block.input && typeof block.input === "object" && !Array.isArray(block.input)) state.toolArguments = block.input as Record<string, unknown>;
    }
    if (record.type === "content_block_delta" && blockDelta?.type === "text_delta" && typeof blockDelta.text === "string") delta = blockDelta.text;
    if (record.type === "content_block_delta" && blockDelta?.type === "input_json_delta" && typeof blockDelta.partial_json === "string") state.toolArgumentsJson += blockDelta.partial_json;
    if (record.type === "message_stop") return true;
  } else {
    const message = provider === "local"
      ? record.message as { content?: unknown; tool_calls?: unknown } | undefined
      : (record.choices as Array<{ delta?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }> | undefined)?.[0]?.delta;
    if (message && typeof message.content === "string") delta = message.content;
    const calls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const call = calls[0] as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | undefined;
    if (call) {
      if (typeof call.id === "string") state.toolId = call.id;
      if (typeof call.function?.name === "string") state.toolName = call.function.name;
      if (typeof call.function?.arguments === "string") state.toolArgumentsJson += call.function.arguments;
      else if (call.function?.arguments && typeof call.function.arguments === "object" && !Array.isArray(call.function.arguments)) state.toolArguments = call.function.arguments as Record<string, unknown>;
    }
    if (provider === "local" && record.done === true) done = true;
    if (provider !== "local" && (record.choices as Array<{ finish_reason?: unknown }> | undefined)?.[0]?.finish_reason) done = true;
  }
  if (delta) {
    state.text += delta;
    onTextDelta(delta);
  }
  return done;
}

export async function streamAiAgentTurn(
  preferences: AiPreferences,
  secretStore: AiSecretStore,
  request: AiCompletionRequest,
  signal: AbortSignal,
  onTextDelta: (delta: string) => void,
  fetchImpl: AiFetch = globalThis.fetch,
): Promise<AgentModelTurn> {
  if (preferences.provider === "none") throw new Error("AI provider is not configured.");
  const secret = secretStore.load(preferences.persistWebSecret) ?? "";
  if (!secret && preferences.provider !== "local") throw new Error("AI provider secret is not configured.");
  const endpoint = normalizeAiEndpoint(preferences.provider, preferences.endpoint);
  const { headers, body } = requestEnvelope(preferences, secret, request, true);
  body.tools = agentTools(preferences.provider);
  let response: Response;
  try { response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (reason) { throw redact(reason instanceof Error ? reason.message : "AI request failed.", secret); }
  if (!response.ok) throw await failedResponse(response, secret);
  if (!response.body) throw new Error("AI response did not provide a stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state: AgentStreamState = { text: "", toolArgumentsJson: "" };
  let buffer = "";
  let complete = false;
  try {
    while (!complete) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split(/\r?\n/gu);
      buffer = chunk.done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : preferences.provider === "local" ? trimmed : "";
        if (!data) continue;
        if (data === "[DONE]") { complete = true; break; }
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { throw new Error("AI agent stream contained invalid JSON."); }
        const eventError = streamEventError(parsed, secret);
        if (eventError) throw eventError;
        if (applyAgentStreamEvent(preferences.provider, parsed, state, onTextDelta)) { complete = true; break; }
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const args = state.toolArgumentsJson ? toolArguments(state.toolArgumentsJson) : state.toolArguments;
  return {
    ...(state.text ? { text: state.text } : {}),
    ...(state.toolName ? { toolCall: { ...(state.toolId ? { id: state.toolId } : {}), name: state.toolName, arguments: args ?? {} } } : {}),
  };
}

function responseMessage(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as { readonly detail?: unknown; readonly error?: unknown; readonly message?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error && typeof parsed.error === "object"
      && typeof (parsed.error as { message?: unknown }).message === "string") {
      return (parsed.error as { message: string }).message;
    }
    if (typeof parsed.message === "string") return parsed.message;
    if (typeof parsed.detail === "string") return parsed.detail;
  } catch { /* A short plain-text provider error is still readable. */ }
  return trimmed.slice(0, 1_000);
}

async function failedResponse(response: Response, secret: string): Promise<Error> {
  let detail = "";
  try { detail = responseMessage(await response.text()); } catch { /* Preserve the status-only fallback. */ }
  return redact(detail
    ? `AI request failed (${response.status}): ${detail}`
    : `AI request failed (${response.status}).`, secret);
}

export async function requestAiCompletion(
  preferences: AiPreferences,
  secretStore: AiSecretStore,
  request: AiCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AiFetch = globalThis.fetch,
): Promise<string> {
  if (preferences.provider === "none") throw new Error("AI provider is not configured.");
  const secret = secretStore.load(preferences.persistWebSecret) ?? "";
  if (!secret && preferences.provider !== "local") throw new Error("AI provider secret is not configured.");
  const endpoint = normalizeAiEndpoint(preferences.provider, preferences.endpoint);
  const { headers, body } = requestEnvelope(preferences, secret, request, false);
  let response: Response;
  try { response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (reason) { throw redact(reason instanceof Error ? reason.message : "AI request failed.", secret); }
  if (!response.ok) throw await failedResponse(response, secret);
  let parsed: unknown;
  try { parsed = await response.json(); } catch { throw new Error("AI response was not valid JSON."); }
  const content = preferences.provider === "anthropic"
    ? (parsed as { content?: Array<{ text?: string }> }).content?.map(({ text }) => text ?? "").join("")
    : preferences.provider === "local"
      ? (parsed as { message?: { content?: string } }).message?.content
      : (parsed as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI response did not contain assistant content.");
  return content;
}

function streamDelta(provider: AiPreferences["provider"], value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { choices?: Array<{ delta?: { content?: string } }>; delta?: { type?: unknown; text?: unknown }; message?: { content?: string } };
  return provider === "anthropic"
    ? item.delta?.type === "text_delta" && typeof item.delta.text === "string" ? item.delta.text : null
    : provider === "local"
      ? item.message?.content ?? null
      : item.choices?.[0]?.delta?.content ?? null;
}

function streamEventError(value: unknown, secret: string): Error | null {
  if (!value || typeof value !== "object") return null;
  const event = value as { readonly type?: unknown; readonly error?: unknown; readonly message?: unknown };
  if (event.type !== "error" && event.error === undefined) return null;
  const detail = typeof event.error === "string"
    ? event.error
    : event.error && typeof event.error === "object" && typeof (event.error as { message?: unknown }).message === "string"
      ? (event.error as { message: string }).message
      : typeof event.message === "string" ? event.message : "Provider stream error.";
  return redact(`AI stream failed: ${detail}`, secret);
}

function decodeStreamLine(provider: AiPreferences["provider"], line: string, secret: string): { readonly done: boolean; readonly delta: string | null } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const data = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : provider === "local" ? trimmed : "";
  if (!data) return null;
  if (data === "[DONE]") return { done: true, delta: null };
  try {
    const parsed = JSON.parse(data) as { readonly done?: unknown };
    const eventError = streamEventError(parsed, secret);
    if (eventError) throw eventError;
    return { done: provider === "local" && parsed.done === true, delta: streamDelta(provider, parsed) };
  } catch (reason) {
    if (reason instanceof Error && reason.message.startsWith("AI stream failed:")) throw reason;
    throw new Error("AI stream contained invalid JSON.");
  }
}

export async function* streamAiCompletion(
  preferences: AiPreferences,
  secretStore: AiSecretStore,
  request: AiCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AiFetch = globalThis.fetch,
): AsyncGenerator<string, void, undefined> {
  if (preferences.provider === "none") throw new Error("AI provider is not configured.");
  const secret = secretStore.load(preferences.persistWebSecret) ?? "";
  if (!secret && preferences.provider !== "local") throw new Error("AI provider secret is not configured.");
  const endpoint = normalizeAiEndpoint(preferences.provider, preferences.endpoint);
  const { headers, body } = requestEnvelope(preferences, secret, request, true);
  let response: Response;
  try { response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (reason) { throw redact(reason instanceof Error ? reason.message : "AI request failed.", secret); }
  if (!response.ok) throw await failedResponse(response, secret);
  if (!response.body) throw new Error("AI response did not provide a stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split(/\r?\n/gu);
      buffer = chunk.done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        const decoded = decodeStreamLine(preferences.provider, line, secret);
        if (decoded?.delta) yield decoded.delta;
        if (decoded?.done) return;
      }
      if (chunk.done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
