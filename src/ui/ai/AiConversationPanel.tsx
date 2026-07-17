import { type FormEvent, useReducer, useRef, useState } from "react";
import { type AiContextInputs, type AiContextToggles, buildAiContextMessage, DEFAULT_AI_CONTEXT_TOGGLES } from "../../application/ai/ai-context";
import { DEFAULT_AI_SYSTEM_PROMPT, type AiMessage } from "../../application/ai/ai-provider";
import type { ProposedEdit } from "../../application/ai/conversation";
import { conversationReducer, createConversationState, extractCodeBlocks } from "../../application/ai/conversation";
import { messages } from "../../messages/en";
import { ExternalChangeDiff } from "../files/ExternalChangeDiff";
import { AiMarkdown } from "./AiMarkdown";

export interface AiConversationPanelProps {
  readonly configured: boolean;
  readonly currentSource: string;
  readonly contextInputs?: AiContextInputs;
  readonly documentId: string;
  readonly requestStream?: (messages: readonly AiMessage[], signal: AbortSignal) => AsyncIterable<string>;
  readonly onApplyEdit?: (proposal: ProposedEdit) => void;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onInsertAtCursor?: (text: string) => void;
  readonly model?: string;
}

export function AiConversationPanel({ configured, contextInputs, currentSource, documentId, requestStream, onApplyEdit, onCopy, onInsertAtCursor, model }: AiConversationPanelProps) {
  const [state, dispatch] = useReducer(conversationReducer, undefined, createConversationState);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [contextToggles, setContextToggles] = useState<AiContextToggles>(DEFAULT_AI_CONTEXT_TOGGLES);
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
      const context = contextInputs ? buildAiContextMessage(contextInputs, contextToggles) : "";
      const requestMessages: AiMessage[] = [{ role: "system", content: DEFAULT_AI_SYSTEM_PROMPT }, ...state.messages.filter(({ role }) => role !== "system").map(({ role, content: messageContent }) => ({ role, content: messageContent })), ...(context ? [{ role: "system" as const, content: context }] : []), userMessage];
      for await (const chunk of requestStream(requestMessages, controller.signal)) {
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
        {state.messages.map((message) => <div data-role={message.role} key={message.id}>{message.role === "assistant" ? <AiMarkdown content={message.content} /> : <p>{message.content}</p>}{message.streaming ? " …" : ""}{message.role === "assistant" && !message.streaming && <button onClick={() => void onCopy?.(message.content)} type="button">{messages.aiCopy}</button>}</div>)}
      </div>
      {error && <p role="alert">{error}</p>}
      {state.proposals.map((proposal) => (
        <div className="ai-proposal" key={proposal.id}>
          {proposal.status === "pending" ? <ExternalChangeDiff
            diskSource={proposal.code}
            localSource={currentSource}
            onApply={(source) => {
              dispatch({ kind: "review-edit", proposalId: proposal.id, status: "accepted" });
              onApplyEdit?.({ ...proposal, code: source });
            }}
          /> : <pre><code>{proposal.code}</code></pre>}
          <div className="ai-proposal-actions"><button onClick={() => void onCopy?.(proposal.code)} type="button">{messages.aiCopy}</button><button onClick={() => onInsertAtCursor?.(proposal.code)} type="button">{messages.aiInsertAtCursor}</button></div>
          {proposal.status !== "pending" && <span>{proposal.status}</span>}
        </div>
      ))}
      <form onSubmit={(event) => void submit(event)}>
        {model && <p><span>{messages.aiModel}: </span>{model}</p>}
        {contextInputs && <fieldset className="ai-context-toggles"><legend>{messages.aiContextLegend}</legend>
          <label><input checked={contextToggles.source} onChange={(event) => setContextToggles((current) => ({ ...current, source: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextSource}</label>
          <label><input checked={contextToggles.diagnostics} onChange={(event) => setContextToggles((current) => ({ ...current, diagnostics: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextDiagnostics}</label>
          <label><input checked={contextToggles.parameters} onChange={(event) => setContextToggles((current) => ({ ...current, parameters: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextParameters}</label>
          <label><input checked={contextToggles.screenshot} onChange={(event) => setContextToggles((current) => ({ ...current, screenshot: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextScreenshot}</label>
        </fieldset>}
        <label>{messages.aiMessageLabel}<textarea onChange={(event) => setInput(event.currentTarget.value)} value={input} /></label>
        <button disabled={!requestStream || !input.trim() || Boolean(state.activeRequestId)} type="submit">{messages.aiSend}</button>
        {state.activeRequestId && <button onClick={() => abortRef.current?.abort()} type="button">{messages.cancelFileAction}</button>}
      </form>
    </section>
  );
}
