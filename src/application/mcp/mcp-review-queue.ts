import type { McpToolName } from "./mcp-tools";
import type { CommandOrigin } from "../runtime/workbench-runtime-contracts";

export interface McpPendingReview {
  readonly commandId: string;
  readonly tool: Extract<McpToolName, "write_file" | "set_parameters">;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly origin: Extract<CommandOrigin, "ai-panel" | "external-agent">;
}

export interface McpReviewQueue {
  list(): readonly McpPendingReview[];
  enqueue(review: McpPendingReview): void;
  approve(commandId: string): McpPendingReview | undefined;
  deny(commandId: string): McpPendingReview | undefined;
  clear(): void;
}

export function createMcpReviewQueue(maxEntries = 64): McpReviewQueue {
  const boundedMax = Number.isInteger(maxEntries) ? Math.min(256, Math.max(1, maxEntries)) : 64;
  let entries: McpPendingReview[] = [];
  return {
    list: () => entries,
    enqueue(review) {
      entries = [...entries.filter(({ commandId }) => commandId !== review.commandId), review].slice(-boundedMax);
    },
    approve(commandId) {
      const review = entries.find(({ commandId: id }) => id === commandId);
      if (!review) return undefined;
      entries = entries.filter(({ commandId: id }) => id !== commandId);
      return review;
    },
    deny(commandId) {
      const review = entries.find(({ commandId: id }) => id === commandId);
      if (!review) return undefined;
      entries = entries.filter(({ commandId: id }) => id !== commandId);
      return review;
    },
    clear() { entries = []; },
  };
}
