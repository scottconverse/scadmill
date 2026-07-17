import type { AiPreferences } from "../settings/settings-schema";
import { type AiCompletionRequest, normalizeAiEndpoint } from "./ai-provider";

export interface AiSecretStore { load(scope: boolean): string | null; }
export type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function redact(message: string): Error {
  return new Error(message.replace(/bearer\s+[^\s,;]+/giu, "Bearer [redacted]").replace(/sk-[A-Za-z0-9_-]+/gu, "[redacted]"));
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
  const headers: Record<string, string> = { "content-type": "application/json" };
  const body: Record<string, unknown> = { model: request.model || preferences.model, messages: request.messages, stream: false };
  if (preferences.provider === "anthropic") {
    headers["x-api-key"] = secret;
    headers["anthropic-version"] = "2023-06-01";
    body.messages = request.messages.filter(({ role }) => role !== "system");
    body.system = request.messages.find(({ role }) => role === "system")?.content;
  } else {
    headers.authorization = `Bearer ${secret}`;
  }
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
