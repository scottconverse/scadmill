import type { AiPreferences } from "../settings/settings-schema";

export interface AiMessage { readonly role: "system" | "user" | "assistant"; readonly content: string; }
export interface AiCompletionRequest { readonly messages: readonly AiMessage[]; readonly model: string; readonly temperature?: number; }
export type AiProvider = Exclude<AiPreferences["provider"], "none">;

export const DEFAULT_AI_SYSTEM_PROMPT = "You are ScadMill's OpenSCAD assistant. Produce valid OpenSCAD source, explain geometry clearly, and keep proposed edits narrowly scoped.";

export function normalizeAiEndpoint(provider: AiProvider, endpoint: string): string {
  const fallback = provider === "openai" ? "https://api.openai.com/v1/chat/completions"
    : provider === "anthropic" ? "https://api.anthropic.com/v1/messages"
      : "http://localhost:11434/api/chat";
  const value = endpoint.trim() || fallback;
  const parsed = new URL(value);
  if (!/^https?:$/u.test(parsed.protocol)) throw new Error("AI endpoint must use HTTP or HTTPS.");
  return parsed.toString();
}
