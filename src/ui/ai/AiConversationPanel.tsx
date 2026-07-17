import { type FormEvent, useReducer, useRef, useState } from "react";
import type { AiMessage } from "../../application/ai/ai-provider";
import type { ProposedEdit } from "../../application/ai/conversation";
import { conversationReducer, createConversationState, extractCodeBlocks } from "../../application/ai/conversation";
import { messages } from "../../messages/en";

export interface AiConversationPanelProps {
  readonly configured: boolean;
  readonly documentId: string;
  readonly requestStream?: (messages: readonly AiMessage[], signal: AbortSignal) => AsyncIterable<string>;
  readonly onApplyEdit?: (proposal: ProposedEdit) => void;
}

export function AiConversationPanel({ configured, documentId, requestStream, onApplyEdit }: AiConversationPanelProps) {
  const [state, dispatch] = useReducer(conversationReducer, undefined, createConversationState);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  if (!configured) return <section aria-label={messages.activityAi}><p>{messages.aiNotConfigured}</p><p>{messages.aiSetupGuidance}</p></section>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || !requestStream || state.activeRequestId) return;
    const requestId = `request-${Date.now()}`;
    const messageId = `message-${requestId}`;
    const userMessage: AiMessage = { role: "user", content };
    setInput("");
    setError(undefined);
    dispatch({ kind: "user-message", message: { id: messageId, ...userMessage, streaming: false } });
    dispatch({ kind: "assistant-start", requestId, messageId: `${messageId}-assistant` });
    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";
    try {
      for await (const chunk of requestStream([...state.messages.filter(({ role }) => role !== "system").map(({ role, content }) => ({ role, content })), userMessage], controller.signal)) {
        reply += chunk;
        dispatch({ kind: "assistant-delta", requestId, content: chunk });
      }
      dispatch({ kind: "assistant-complete", requestId });
      for (const [index, block] of extractCodeBlocks(reply).entries()) {
        dispatch({ kind: "propose-edit", proposal: { id: `${messageId}-proposal-${index}`, messageId: `${messageId}-assistant`, documentId, ...block, status: "pending" } });
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : messages.aiRequestFailed);
      dispatch({ kind: "cancel", requestId });
    } finally {
      abortRef.current = undefined;
    }
  };
  return (
    <section aria-label={messages.activityAi} className="ai-conversation">
      <div aria-live="polite" className="ai-conversation-messages">
        {state.messages.map((message) => <p key={message.id} data-role={message.role}>{message.content}{message.streaming ? " …" : ""}</p>)}
      </div>
      {error && <p role="alert">{error}</p>}
      {state.proposals.map((proposal) => (
        <div className="ai-proposal" key={proposal.id}>
          <pre><code>{proposal.code}</code></pre>
          {proposal.status === "pending" && <button onClick={() => { dispatch({ kind: "review-edit", proposalId: proposal.id, status: "accepted" }); onApplyEdit?.(proposal); }} type="button">{messages.applyEdit}</button>}
          {proposal.status !== "pending" && <span>{proposal.status}</span>}
        </div>
      ))}
      <form onSubmit={(event) => void submit(event)}>
        <label>{messages.aiMessageLabel}<textarea onChange={(event) => setInput(event.currentTarget.value)} value={input} /></label>
        <button disabled={!requestStream || !input.trim() || Boolean(state.activeRequestId)} type="submit">{messages.aiSend}</button>
        {state.activeRequestId && <button onClick={() => abortRef.current?.abort()} type="button">{messages.cancelFileAction}</button>}
      </form>
    </section>
  );
}
