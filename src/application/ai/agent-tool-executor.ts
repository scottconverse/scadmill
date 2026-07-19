import type { McpToolHandler } from "../mcp/mcp-dispatcher";
import { validateMcpRequest } from "../mcp/mcp-tools";
import type { AgentToolCall, AgentToolExecutor } from "./agent-loop";

export const AI_AGENT_TOOL_NAMES = [
  "read_file",
  "write_file",
  "render_preview",
  "get_diagnostics",
  "take_screenshot",
] as const;
const AGENT_TOOL_NAME_SET = new Set<string>(AI_AGENT_TOOL_NAMES);

export interface AgentToolExecutorOptions {
  readonly autoApply?: boolean;
  readonly approvePending?: (commandId: string) => Promise<void>;
}

function pendingReviewId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result = value as { status?: unknown; commandId?: unknown };
  return result.status === "pending_review" && typeof result.commandId === "string"
    ? result.commandId
    : undefined;
}

export function createAgentToolExecutor(
  handler: McpToolHandler,
  options: AgentToolExecutorOptions = {},
): AgentToolExecutor {
  return {
    async call(tool: AgentToolCall, signal: AbortSignal): Promise<unknown> {
      if (signal.aborted) throw new Error("AI agent tool call was cancelled.");
      if (!AGENT_TOOL_NAME_SET.has(tool.name)) {
        throw new Error(`${tool.name} is not available in AI agent mode.`);
      }
      const validated = validateMcpRequest({ name: tool.name, arguments: tool.arguments });
      if (!validated.ok || !validated.tool || !validated.arguments) {
        throw new Error(validated.error ?? "AI agent tool arguments are invalid.");
      }
      const result = await handler.call(validated.tool, validated.arguments, signal);
      if (signal.aborted) throw new Error("AI agent tool call was cancelled.");
      const commandId = pendingReviewId(result);
      if (!options.autoApply || !commandId) return result;
      if (!options.approvePending) throw new Error("AI agent auto-apply is unavailable.");
      await options.approvePending(commandId);
      return { status: "applied", commandId };
    },
  };
}
