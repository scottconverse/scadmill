export type ConversationRole = "user" | "assistant" | "system";
export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface ConversationMessage {
  readonly id: string;
  readonly role: ConversationRole;
  readonly content: string;
  readonly streaming: boolean;
}

export interface ProposedEdit {
  readonly id: string;
  readonly messageId: string;
  readonly documentId: string;
  readonly code: string;
  readonly language: string;
  readonly status: ProposalStatus;
}

export interface ConversationState {
  readonly messages: readonly ConversationMessage[];
  readonly proposals: readonly ProposedEdit[];
  readonly activeRequestId: string | null;
  readonly configurationId: string | null;
}

export type ConversationAction =
  | { readonly kind: "user-message"; readonly message: ConversationMessage }
  | { readonly kind: "assistant-start"; readonly requestId: string; readonly messageId: string }
  | { readonly kind: "assistant-delta"; readonly requestId: string; readonly content: string }
  | { readonly kind: "assistant-complete"; readonly requestId: string }
  | { readonly kind: "cancel"; readonly requestId: string }
  | { readonly kind: "propose-edit"; readonly proposal: ProposedEdit }
  | { readonly kind: "review-edit"; readonly proposalId: string; readonly status: Exclude<ProposalStatus, "pending"> }
  | { readonly kind: "select-configuration"; readonly configurationId: string }
  | { readonly kind: "clear" };

export function createConversationState(): ConversationState {
  return { messages: [], proposals: [], activeRequestId: null, configurationId: null };
}

export function extractCodeBlocks(markdown: string): readonly { language: string; code: string }[] {
  const blocks: Array<{ language: string; code: string }> = [];
  const pattern = /```([^\r\n`]*)\r?\n([\s\S]*?)```/gu;
  for (const match of markdown.matchAll(pattern)) {
    const language = (match[1] ?? "").trim().toLowerCase();
    const code = match[2] ?? "";
    if (code.length > 0) blocks.push({ language, code });
  }
  return blocks;
}

function updateMessage(
  messages: readonly ConversationMessage[],
  id: string,
  update: (message: ConversationMessage) => ConversationMessage,
): readonly ConversationMessage[] {
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = update(next[index]);
  return next;
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.kind) {
    case "user-message":
      return { ...state, messages: [...state.messages, { ...action.message, role: "user", streaming: false }] };
    case "assistant-start":
      return {
        ...state,
        activeRequestId: action.requestId,
        messages: [...state.messages, { id: action.messageId, role: "assistant", content: "", streaming: true }],
      };
    case "assistant-delta": {
      if (state.activeRequestId !== action.requestId) return state;
      const message = [...state.messages].reverse().find(({ role, streaming }) => role === "assistant" && streaming);
      return message
        ? { ...state, messages: updateMessage(state.messages, message.id, (current) => ({ ...current, content: current.content + action.content })) }
        : state;
    }
    case "assistant-complete":
    case "cancel": {
      if (state.activeRequestId !== action.requestId) return state;
      const messages = state.messages.map((message) => message.streaming ? { ...message, streaming: false } : message);
      return { ...state, activeRequestId: null, messages };
    }
    case "propose-edit":
      return state.proposals.some(({ id }) => id === action.proposal.id)
        ? state
        : { ...state, proposals: [...state.proposals, { ...action.proposal, status: "pending" }] };
    case "review-edit":
      return {
        ...state,
        proposals: state.proposals.map((proposal) => proposal.id === action.proposalId ? { ...proposal, status: action.status } : proposal),
      };
    case "select-configuration":
      return { ...state, configurationId: action.configurationId };
    case "clear":
      return createConversationState();
  }
}
