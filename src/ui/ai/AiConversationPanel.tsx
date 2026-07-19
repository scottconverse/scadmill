import { type FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { type AiContextInputs, type AiContextToggles, buildAiContextMessage, DEFAULT_AI_CONTEXT_TOGGLES } from "../../application/ai/ai-context";
import { DEFAULT_AGENT_ROUND_CAP, runAgentLoop, type AgentModelTurn } from "../../application/ai/agent-loop";
import { createAgentToolExecutor } from "../../application/ai/agent-tool-executor";
import { DEFAULT_AI_SYSTEM_PROMPT, type AiMessage } from "../../application/ai/ai-provider";
import type { ProposedEdit } from "../../application/ai/conversation";
import { conversationReducer, extractCodeBlocks } from "../../application/ai/conversation";
import { EPHEMERAL_CONVERSATION_PERSISTENCE, loadConversation, saveConversation, type ConversationPersistence } from "../../application/ai/conversation-persistence";
import { messages } from "../../messages/en";
import type { McpToolHandler } from "../../application/mcp/mcp-dispatcher";
import { ExternalChangeDiff } from "../files/ExternalChangeDiff";
import { AiMarkdown } from "./AiMarkdown";
import type { AiConversationConfiguration } from "./ai-runtime-bridge";

export interface AiConversationPanelProps {
  readonly configured: boolean;
  readonly currentSource: string;
  readonly sourceForDocument?: (documentId: string) => string;
  readonly contextInputs?: AiContextInputs;
  readonly documentId: string;
  readonly requestStream?: (messages: readonly AiMessage[], signal: AbortSignal, model?: string) => AsyncIterable<string>;
  readonly requestAgentTurn?: (messages: readonly AiMessage[], signal: AbortSignal, model?: string, onTextDelta?: (delta: string) => void) => Promise<AgentModelTurn>;
  readonly agentToolHandler?: McpToolHandler;
  readonly approveAgentReview?: (commandId: string) => Promise<void>;
  readonly configurations?: readonly AiConversationConfiguration[];
  readonly loadConfigurationSecret?: (configurationId?: string) => Promise<string | null>;
  readonly loadPersistenceSecrets?: () => Promise<readonly string[]>;
  readonly configurationRequiresSecret?: (configurationId?: string) => boolean;
  readonly onApplyEdit?: (proposal: ProposedEdit) => void | Promise<void>;
  readonly onCopy?: (text: string) => Promise<void>;
  readonly onInsertAtCursor?: (text: string) => void;
  readonly persistence?: ConversationPersistence;
}

export function AiConversationPanel({ configured, contextInputs, currentSource, sourceForDocument, documentId, requestStream, requestAgentTurn, agentToolHandler, approveAgentReview, configurations = [], loadConfigurationSecret, loadPersistenceSecrets, configurationRequiresSecret = () => true, onApplyEdit, onCopy, onInsertAtCursor, persistence = EPHEMERAL_CONVERSATION_PERSISTENCE }: AiConversationPanelProps) {
  const [state, dispatch] = useReducer(conversationReducer, persistence, loadConversation);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [secretStatus, setSecretStatus] = useState<"loading" | "ready" | "missing" | "failed">(
    loadConfigurationSecret ? "loading" : "ready",
  );
  const [contextToggles, setContextToggles] = useState<AiContextToggles>(DEFAULT_AI_CONTEXT_TOGGLES);
  const [agentMode, setAgentMode] = useState(false);
  const [agentRoundCap, setAgentRoundCap] = useState(DEFAULT_AGENT_ROUND_CAP);
  const [agentAutoApply, setAgentAutoApply] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"idle" | "running" | "completed" | "capped" | "cancelled">("idle");
  const [applyingProposalIds, setApplyingProposalIds] = useState<readonly string[]>([]);
  const selectedConfigurationId = configurations.some(({ id }) => id === state.configurationId)
    ? state.configurationId ?? ""
    : configurations[0]?.id ?? "";
  useEffect(() => {
    if (selectedConfigurationId && state.configurationId !== selectedConfigurationId) {
      dispatch({ kind: "select-configuration", configurationId: selectedConfigurationId });
    }
  }, [selectedConfigurationId, state.configurationId]);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const cancelActive = () => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    setAgentStatus("cancelled");
  };
  useEffect(() => () => abortRef.current?.abort(), []);
  const saveGeneration = useRef(0);
  useEffect(() => {
    let active = true;
    if (!loadConfigurationSecret) {
      setSecretStatus("ready");
      return () => { active = false; };
    }
    setError(undefined);
    setSecretStatus("loading");
    void loadConfigurationSecret(selectedConfigurationId).then(
      (secret) => {
        if (!active) return;
        const required = configurationRequiresSecret(selectedConfigurationId);
        setSecretStatus(required && !secret ? "missing" : "ready");
        if (required && !secret) setError(messages.aiSecretMissing);
      },
      () => {
        if (!active) return;
        setSecretStatus("failed");
        setError(messages.aiSecretLoadFailed);
      },
    );
    return () => { active = false; };
  }, [configurationRequiresSecret, loadConfigurationSecret, selectedConfigurationId]);
  useEffect(() => {
    if (secretStatus !== "ready" || state.activeRequestId) return;
    const generation = ++saveGeneration.current;
    if (!loadPersistenceSecrets) {
      saveConversation(persistence, state);
      return;
    }
    void loadPersistenceSecrets().then((secrets) => {
      if (generation === saveGeneration.current) saveConversation(persistence, state, secrets);
    }, () => setError(messages.aiConversationPersistenceFailed));
  }, [loadPersistenceSecrets, persistence, secretStatus, state]);
  if (!configured) return <section aria-label={messages.activityAi}><p>{messages.aiNotConfigured}</p><p>{messages.aiSetupGuidance}</p></section>;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || !requestStream || state.activeRequestId || secretStatus !== "ready") return;
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
      if (agentMode) {
        if (!requestAgentTurn || !agentToolHandler) throw new Error(messages.aiAgentUnavailable);
        setAgentStatus("running");
        let streamedAgentText = false;
        const result = await runAgentLoop(
          requestMessages,
          (messages, signal) => {
            let emittedRoundText = false;
            return requestAgentTurn(messages, signal, selectedConfigurationId, (delta) => {
              if (!emittedRoundText && streamedAgentText) dispatch({ kind: "assistant-delta", requestId, content: "\n\n" });
              emittedRoundText = true;
              streamedAgentText = true;
              dispatch({ kind: "assistant-delta", requestId, content: delta });
            });
          },
          createAgentToolExecutor(agentToolHandler, {
            autoApply: agentAutoApply,
            approvePending: approveAgentReview,
          }),
          controller.signal,
          { enabled: true, maxRounds: agentRoundCap },
        );
        reply = result.messages.slice(requestMessages.length)
          .filter(({ role }) => role === "assistant")
          .map(({ content: assistantContent }) => assistantContent)
          .join("\n\n");
        if (reply && !streamedAgentText) {
          dispatch({ kind: "assistant-delta", requestId, content: reply });
        }
        setAgentStatus(controller.signal.aborted ? "cancelled" : result.state.status === "capped" ? "capped" : "completed");
      } else {
        for await (const chunk of requestStream(requestMessages, controller.signal, selectedConfigurationId)) {
          reply += chunk;
          dispatch({ kind: "assistant-delta", requestId, content: chunk });
        }
      }
      dispatch({ kind: "assistant-complete", requestId });
      for (const [index, block] of extractCodeBlocks(reply).entries()) {
        dispatch({ kind: "propose-edit", proposal: { id: `${messageId}-proposal-${index}`, messageId: `${messageId}-assistant`, documentId, ...block, status: "pending" } });
      }
    } catch (reason) {
      if (controller.signal.aborted) setAgentStatus("cancelled");
      else setError(reason instanceof Error ? reason.message : messages.aiRequestFailed);
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
          {proposal.status === "pending" && applyingProposalIds.includes(proposal.id)
            ? <p role="status">{messages.aiApplyingEdit}</p>
            : proposal.status === "pending" ? <ExternalChangeDiff
            diskSource={proposal.code}
            localSource={sourceForDocument?.(proposal.documentId) ?? currentSource}
            onApply={(source) => {
              if (!onApplyEdit || applyingProposalIds.includes(proposal.id)) return;
              setApplyingProposalIds((current) => [...current, proposal.id]);
              void Promise.resolve(onApplyEdit({ ...proposal, code: source })).then(
                () => dispatch({ kind: "review-edit", proposalId: proposal.id, status: "accepted" }),
                (reason: unknown) => setError(reason instanceof Error ? reason.message : messages.aiApplyEditFailed),
              ).finally(() => setApplyingProposalIds((current) => current.filter((id) => id !== proposal.id)));
            }}
          /> : <pre><code>{proposal.code}</code></pre>}
          <div className="ai-proposal-actions"><button onClick={() => void onCopy?.(proposal.code)} type="button">{messages.aiCopy}</button><button onClick={() => onInsertAtCursor?.(proposal.code)} type="button">{messages.aiInsertAtCursor}</button></div>
          {proposal.status !== "pending" && <span>{proposal.status}</span>}
        </div>
      ))}
      <form onSubmit={(event) => void submit(event)}>
        {configurations.length > 0 && <label>{messages.aiConversationModel}<select aria-label={messages.aiConversationModel} onChange={(event) => dispatch({ kind: "select-configuration", configurationId: event.currentTarget.value })} value={selectedConfigurationId}>{configurations.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>}
        <button onClick={() => { cancelActive(); persistence.clear(); dispatch({ kind: "clear" }); setAgentMode(false); setAgentRoundCap(DEFAULT_AGENT_ROUND_CAP); setAgentAutoApply(false); setAgentStatus("idle"); }} type="button">{messages.aiClearConversation}</button>
        <fieldset className="ai-agent-controls"><legend>{messages.aiAgentMode}</legend>
          <label><input checked={agentMode} onChange={(event) => { setAgentMode(event.currentTarget.checked); if (!event.currentTarget.checked) { setAgentAutoApply(false); setAgentStatus("idle"); } }} type="checkbox" />{messages.aiAgentOptIn}</label>
          {agentMode && <>
            <label>{messages.aiAgentRoundCap}<input aria-label={messages.aiAgentRoundCap} max="100" min="1" onChange={(event) => setAgentRoundCap(Math.min(100, Math.max(1, Number(event.currentTarget.value) || DEFAULT_AGENT_ROUND_CAP)))} type="number" value={agentRoundCap} /></label>
            <label><input checked={agentAutoApply} onChange={(event) => setAgentAutoApply(event.currentTarget.checked)} type="checkbox" />{messages.aiAgentAutoApply}</label>
            <p aria-live="polite">{messages.aiAgentStatus(agentStatus)}</p>
          </>}
        </fieldset>
        {contextInputs && <fieldset className="ai-context-toggles"><legend>{messages.aiContextLegend}</legend>
          <label><input checked={contextToggles.source} onChange={(event) => setContextToggles((current) => ({ ...current, source: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextSource}</label>
          <label><input checked={contextToggles.diagnostics} onChange={(event) => setContextToggles((current) => ({ ...current, diagnostics: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextDiagnostics}</label>
          <label><input checked={contextToggles.parameters} onChange={(event) => setContextToggles((current) => ({ ...current, parameters: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextParameters}</label>
          <label><input checked={contextToggles.screenshot} onChange={(event) => setContextToggles((current) => ({ ...current, screenshot: event.currentTarget.checked }))} type="checkbox" />{messages.aiContextScreenshot}</label>
        </fieldset>}
        <label>{messages.aiMessageLabel}<textarea onChange={(event) => setInput(event.currentTarget.value)} value={input} /></label>
        <button disabled={!requestStream || !input.trim() || Boolean(state.activeRequestId) || secretStatus !== "ready" || (agentMode && (!requestAgentTurn || !agentToolHandler))} type="submit">{messages.aiSend}</button>
        {state.activeRequestId && <button onClick={cancelActive} type="button">{messages.cancelFileAction}</button>}
      </form>
    </section>
  );
}
