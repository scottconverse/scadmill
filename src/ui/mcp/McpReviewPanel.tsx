import { useState } from "react";

import type { McpPendingReview } from "../../application/mcp/mcp-review-queue";
import type { HistoryEntry } from "../../application/runtime/workbench-runtime-contracts";
import { messages } from "../../messages/en";
import { ExternalChangeDiff } from "../files/ExternalChangeDiff";

export interface McpReviewPanelProps {
  readonly history: readonly HistoryEntry[];
  readonly pendingReviews: readonly McpPendingReview[];
  readonly sourceForPath: (path: string) => string;
  readonly onApprove: (review: McpPendingReview) => Promise<void>;
  readonly onDeny: (commandId: string) => void;
}

function textArgument(review: McpPendingReview, name: string): string {
  const value = review.arguments[name];
  return typeof value === "string" ? value : "";
}

function valuesArgument(review: McpPendingReview): Readonly<Record<string, unknown>> {
  const values = review.arguments.values;
  return values && typeof values === "object" && !Array.isArray(values)
    ? values as Readonly<Record<string, unknown>>
    : {};
}

function ReviewCard({ review, sourceForPath, onApprove, onDeny }: Omit<McpReviewPanelProps, "history" | "pendingReviews"> & { readonly review: McpPendingReview }) {
  const path = textArgument(review, "path");
  const [error, setError] = useState<string>();
  const approve = async () => {
    setError(undefined);
    try {
      await onApprove(review);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.mcpReviewApplyFailed);
    }
  };
  return (
    <article className="mcp-review-card">
      <header>
        <strong>{review.tool === "write_file" ? messages.mcpWriteReview(path) : messages.mcpParameterReview(path)}</strong>
        <span>{messages.mcpReviewPending}</span>
      </header>
      {review.tool === "write_file" ? (
        <ExternalChangeDiff diskSource={textArgument(review, "content")} localSource={sourceForPath(path)} onApply={(source) => void approveWithSource(source)} />
      ) : (
        <pre className="mcp-review-values">{JSON.stringify(valuesArgument(review), null, 2)}</pre>
      )}
      <div className="mcp-review-actions">
        <button onClick={() => void approve()} type="button">{messages.mcpApproveReview}</button>
        <button onClick={() => onDeny(review.commandId)} type="button">{messages.mcpDenyReview}</button>
      </div>
      {error && <p className="mcp-review-error" role="alert">{error}</p>}
    </article>
  );

  async function approveWithSource(source: string): Promise<void> {
    const amended: McpPendingReview = {
      ...review,
      arguments: { ...review.arguments, content: source },
    };
    setError(undefined);
    try {
      await onApprove(amended);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : messages.mcpReviewApplyFailed);
    }
  }
}

export function McpReviewPanel({ history, pendingReviews, sourceForPath, onApprove, onDeny }: McpReviewPanelProps) {
  return (
    <section aria-label={messages.mcpReviewPanel} className="mcp-review-panel">
      <h2>{messages.mcpReviewPanel}</h2>
      {pendingReviews.length === 0 ? <p>{messages.noMcpReviews}</p> : pendingReviews.map((review) => (
        <ReviewCard key={review.commandId} review={review} sourceForPath={sourceForPath} onApprove={onApprove} onDeny={onDeny} />
      ))}
      <h3>{messages.workspaceHistory}</h3>
      {history.length === 0 ? <p>{messages.noHistoryYet}</p> : (
        <ol className="workspace-history-list">
          {history.map((entry) => (
            <li key={entry.commandId}>
              {entry.origin === "external-agent" && <span className="external-agent-badge">{messages.externalAgentBadge}</span>}
              <span>{entry.summary}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
