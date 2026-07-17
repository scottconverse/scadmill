import type { AiPreferences } from "../settings/settings-schema";
import { type AiCompletionRequest, normalizeAiEndpoint } from "./ai-provider";

export interface AiSecretStore { load(scope: boolean): string | null; }
export type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function redact(message: string): Error {
  return new Error(message.replace(/bearer\s+[^\s,;]+/giu, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]+/gu, "[redacted]"));
}

function requestEnvelope(preferences: AiPreferences, secret: string, request: AiCompletionRequest, stream: boolean) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const body: Record<string, unknown> = { model: request.model || preferences.model, messages: request.messages, stream };
  if (preferences.provider === "anthropic") {
    headers["x-api-key"] = secret;
    headers["anthropic-version"] = "2023-06-01";
    body.messages = request.messages.filter(({ role }) => role !== "system");
    body.system = request.messages.find(({ role }) => role === "system")?.content;
  } else {
    headers.authorization = `Bearer ${secret}`;
  }
  return { headers, body };
}

export async function requestAiCompletion(
  preferences: AiPreferences,
  secretStore: AiSecretStore,
  request: AiCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AiFetch = globalThis.fetch,
): Promise<string> {
  if (preferences.provider === "none") throw new Error("AI provider is not configured.");
  const secret = secretStore.load(preferences.persistWebSecret);
  if (!secret) throw new Error("AI provider secret is not configured.");
  const endpoint = normalizeAiEndpoint(preferences.provider, preferences.endpoint);
  const { headers, body } = requestEnvelope(preferences, secret, request, false);
  let response: Response;
  try { response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (reason) { throw redact(reason instanceof Error ? reason.message : "AI request failed."); }
  if (!response.ok) throw redact(`AI request failed (${response.status}).`);
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
  const item = value as { choices?: Array<{ delta?: { content?: string } }>; content_block_delta?: { delta?: { text?: string } }; message?: { content?: string } };
  return provider === "anthropic"
    ? item.content_block_delta?.delta?.text ?? null
    : provider === "local"
      ? item.message?.content ?? null
      : item.choices?.[0]?.delta?.content ?? null;
}

export async function* streamAiCompletion(
  preferences: AiPreferences,
  secretStore: AiSecretStore,
  request: AiCompletionRequest,
  signal: AbortSignal,
  fetchImpl: AiFetch = globalThis.fetch,
): AsyncGenerator<string, void, undefined> {
  if (preferences.provider === "none") throw new Error("AI provider is not configured.");
  const secret = secretStore.load(preferences.persistWebSecret);
  if (!secret) throw new Error("AI provider secret is not configured.");
  const endpoint = normalizeAiEndpoint(preferences.provider, preferences.endpoint);
  const { headers, body } = requestEnvelope(preferences, secret, request, true);
  let response: Response;
  try { response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal }); }
  catch (reason) { throw redact(reason instanceof Error ? reason.message : "AI request failed."); }
  if (!response.ok) throw redact(`AI request failed (${response.status}).`);
  if (!response.body) throw new Error("AI response did not provide a stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split(/\r?\n/gu);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const delta = streamDelta(preferences.provider, JSON.parse(data));
          if (delta) yield delta;
        } catch { throw new Error("AI stream contained invalid JSON."); }
      }
      if (chunk.done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
