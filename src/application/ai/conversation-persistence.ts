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

function safeText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function redact(value: string, secret: string | undefined): string {
  return secret && secret.length > 0 ? value.split(secret).join("[redacted]") : value;
}

export function serializeConversation(state: ConversationState, secret?: string): string {
  const messages = state.messages.slice(-MAX_MESSAGES).map((message) => ({
    id: message.id,
    role: message.role,
    content: redact(message.content, secret),
    streaming: false,
  }));
  const proposals = state.proposals.slice(-MAX_PROPOSALS).map((proposal) => ({
    id: proposal.id,
    messageId: proposal.messageId,
    documentId: proposal.documentId,
    code: redact(proposal.code, secret),
    language: proposal.language,
    status: proposal.status,
  }));
  return JSON.stringify({ schemaVersion: 1, messages, proposals });
}

export function deserializeConversation(serialized: string | null): ConversationState {
  if (!serialized) return { messages: [], proposals: [], activeRequestId: null };
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || (parsed as { schemaVersion?: unknown }).schemaVersion !== 1) {
      return { messages: [], proposals: [], activeRequestId: null };
    }
    const value = parsed as { messages?: unknown; proposals?: unknown };
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
    return { messages, proposals, activeRequestId: null };
  } catch {
    return { messages: [], proposals: [], activeRequestId: null };
  }
}

export function loadConversation(persistence: ConversationPersistence): ConversationState {
  return deserializeConversation(persistence.load());
}

export function saveConversation(persistence: ConversationPersistence, state: ConversationState, secret?: string): void {
  persistence.save(serializeConversation(state, secret));
}
