import type { AiMessage } from "./ai-provider";

export const DEFAULT_AGENT_ROUND_CAP = 10;

export interface AgentLoopState {
  readonly enabled: boolean;
  readonly rounds: number;
  readonly maxRounds: number;
  readonly status: "idle" | "running" | "capped" | "completed";
}

export interface AgentToolCall {
  readonly id?: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface AgentModelTurn {
  readonly text?: string;
  readonly toolCall?: AgentToolCall;
}

export interface AgentToolExecutor {
  call(tool: AgentToolCall, signal: AbortSignal): Promise<unknown>;
}

export interface AgentRunResult {
  readonly state: AgentLoopState;
  readonly messages: readonly AiMessage[];
  readonly toolResults: readonly unknown[];
}

export function createAgentLoop(enabled = false, requestedCap = DEFAULT_AGENT_ROUND_CAP): AgentLoopState {
  const maxRounds = Number.isInteger(requestedCap) ? Math.min(100, Math.max(1, requestedCap)) : DEFAULT_AGENT_ROUND_CAP;
  return { enabled, rounds: 0, maxRounds, status: enabled ? "running" : "idle" };
}

export function requestAgentRound(state: AgentLoopState): AgentLoopState {
  if (!state.enabled || state.status !== "running") return state;
  const rounds = state.rounds + 1;
  return rounds >= state.maxRounds ? { ...state, rounds, status: "capped" } : { ...state, rounds };
}

export function completeAgentLoop(state: AgentLoopState): AgentLoopState {
  return state.status === "running" ? { ...state, status: "completed" } : state;
}

export async function runAgentLoop(
  initialMessages: readonly AiMessage[],
  model: (messages: readonly AiMessage[], signal: AbortSignal) => Promise<AgentModelTurn>,
  tools: AgentToolExecutor,
  signal: AbortSignal,
  options?: { readonly enabled?: boolean; readonly maxRounds?: number },
): Promise<AgentRunResult> {
  let state = createAgentLoop(options?.enabled ?? false, options?.maxRounds ?? DEFAULT_AGENT_ROUND_CAP);
  const messages: AiMessage[] = [...initialMessages];
  const toolResults: unknown[] = [];
  if (!state.enabled) return { state, messages, toolResults };
  while (state.status === "running") {
    if (signal.aborted) return { state: { ...state, status: "completed" }, messages, toolResults };
    const turn = await model(messages, signal);
    if (turn.text) messages.push({ role: "assistant", content: turn.text });
    if (!turn.toolCall) return { state: completeAgentLoop(state), messages, toolResults };
    if (!turn.text) messages.push({ role: "assistant", content: "", toolCall: turn.toolCall });
    else messages[messages.length - 1] = { role: "assistant", content: turn.text, toolCall: turn.toolCall };
    state = requestAgentRound(state);
    const result = await tools.call(turn.toolCall, signal);
    toolResults.push(result);
    messages.push({
      role: "tool",
      content: JSON.stringify(result) ?? "null",
      ...(turn.toolCall.id ? { toolCallId: turn.toolCall.id } : {}),
      toolName: turn.toolCall.name,
    });
  }
  return { state, messages, toolResults };
}
