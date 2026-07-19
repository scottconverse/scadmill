import type { ConversationMessage, ConversationRole, ConversationState, ProposedEdit, ProposalStatus } from "./conversation";

const MAX_MESSAGES = 200;
const MAX_PROPOSALS = 100;
const MAX_TEXT = 64 * 1024;
const MAX_CODE = 128 * 1024;

export interface ConversationPersistence {
  load(): string | null;
  save(serialized: string): void;
  clear(): void;
}

export const EPHEMERAL_CONVERSATION_PERSISTENCE: ConversationPersistence = Object.freeze({
  load: () => null,
  save: () => undefined,
  clear: () => undefined,
});

export interface StringStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createLocalConversationPersistence(projectIdentity: string, storage?: StringStorage): ConversationPersistence {
  if (!projectIdentity.trim()) throw new Error("AI conversation persistence requires a project identity.");
  const key = `scadmill.ai.conversation.v1.${encodeURIComponent(projectIdentity)}`;
  const target = storage ?? (globalThis.localStorage as StringStorage | undefined);
  return {
    load: () => {
      try { return target?.getItem(key) ?? null; } catch { return null; }
    },
    save: (serialized) => {
      try { target?.setItem(key, serialized); } catch { /* Persistence is fail-safe for editing. */ }
    },
    clear: () => {
      try { target?.removeItem(key); } catch { /* Persistence is fail-safe for editing. */ }
    },
  };
}

function safeText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function redact(value: string, secrets: string | readonly string[] | undefined): string {
  const values = typeof secrets === "string" ? [secrets] : secrets ?? [];
  return values.filter(Boolean).reduce((current, secret) => current.split(secret).join("[redacted]"), value);
}

export function serializeConversation(state: ConversationState, secrets?: string | readonly string[]): string {
  const messages = state.messages.slice(-MAX_MESSAGES).map((message) => ({
    id: message.id,
    role: message.role,
    content: redact(message.content, secrets),
    streaming: false,
  }));
  const proposals = state.proposals.slice(-MAX_PROPOSALS).map((proposal) => ({
    id: proposal.id,
    messageId: proposal.messageId,
    documentId: proposal.documentId,
    code: redact(proposal.code, secrets),
    language: proposal.language,
    status: proposal.status,
  }));
  return JSON.stringify({ schemaVersion: 1, configurationId: state.configurationId, messages, proposals });
}

export function deserializeConversation(serialized: string | null): ConversationState {
  if (!serialized) return { messages: [], proposals: [], activeRequestId: null, configurationId: null };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) {
      return { messages: [], proposals: [], activeRequestId: null, configurationId: null };
    }
    const value = parsed as { configurationId?: unknown; messages?: unknown; proposals?: unknown };
    const configurationId = value.configurationId === undefined || value.configurationId === null
      ? null
      : safeText(value.configurationId, 8_192);
    const messages: ConversationMessage[] = Array.isArray(value.messages)
      ? value.messages.flatMap((message) => {
          if (!message || typeof message !== "object") return [];
          const item = message as Record<string, unknown>;
          const id = safeText(item.id, 200);
          const role = item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : null;
          const content = safeText(item.content, MAX_TEXT);
          return id && role && content !== null ? [{ id, role: role as ConversationRole, content, streaming: false as const }] : [];
        }).slice(-MAX_MESSAGES)
      : [];
    const proposals: ProposedEdit[] = Array.isArray(value.proposals)
      ? value.proposals.flatMap((proposal) => {
          if (!proposal || typeof proposal !== "object") return [];
          const item = proposal as Record<string, unknown>;
          const id = safeText(item.id, 200);
          const messageId = safeText(item.messageId, 200);
          const documentId = safeText(item.documentId, 200);
          const code = safeText(item.code, MAX_CODE);
          const language = safeText(item.language, 40);
          const status = item.status === "pending" || item.status === "accepted" || item.status === "rejected" ? item.status : null;
          return id && messageId && documentId && code !== null && language !== null && status ? [{ id, messageId, documentId, code, language, status: status as ProposalStatus }] : [];
        }).slice(-MAX_PROPOSALS)
      : [];
    return { messages, proposals, activeRequestId: null, configurationId };
  } catch {
    return { messages: [], proposals: [], activeRequestId: null, configurationId: null };
  }
}

export function loadConversation(persistence: ConversationPersistence): ConversationState {
  return deserializeConversation(persistence.load());
}

export function saveConversation(persistence: ConversationPersistence, state: ConversationState, secrets?: string | readonly string[]): void {
  persistence.save(serializeConversation(state, secrets));
}
