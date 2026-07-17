export const DEFAULT_AGENT_ROUND_CAP = 10;

export interface AgentLoopState {
  readonly enabled: boolean;
  readonly rounds: number;
  readonly maxRounds: number;
  readonly status: "idle" | "running" | "capped" | "completed";
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
