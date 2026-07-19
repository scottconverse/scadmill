import { useState } from "react";

import type { McpPendingReview } from "../../application/mcp/mcp-review-queue";
import type {
  HistoryDetail,
  HistoryEntry,
} from "../../application/runtime/workbench-runtime-contracts";
import { messages } from "../../messages/en";
import { ExternalChangeDiff } from "../files/ExternalChangeDiff";
import "./history-panel.css";

export interface McpReviewPanelProps {
  readonly history: readonly HistoryEntry[];
  readonly historyDetails: ReadonlyMap<string, HistoryDetail>;
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

function ReviewCard({ review, sourceForPath, onApprove, onDeny }: Omit<McpReviewPanelProps, "history" | "historyDetails" | "pendingReviews"> & { readonly review: McpPendingReview }) {
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

function originLabel(origin: HistoryEntry["origin"]): string {
  switch (origin) {
    case "user": return messages.historyOriginUser;
    case "ai-panel": return messages.historyOriginAi;
    case "external-agent": return messages.externalAgentBadge;
    case "system": return messages.historyOriginSystem;
  }
}

export function McpReviewPanel({
  history,
  historyDetails,
  pendingReviews,
  sourceForPath,
  onApprove,
  onDeny,
}: McpReviewPanelProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = history.find(({ commandId }) => commandId === selectedId);
  const detail = selected ? historyDetails.get(selected.commandId) : undefined;
  return (
    <section aria-label={messages.workspaceHistory} className="mcp-review-panel">
      <h2>{messages.workspaceHistory}</h2>
      {history.length === 0 ? <p>{messages.noHistoryYet}</p> : (
        <ol className="workspace-history-list">
          {[...history].reverse().map((entry) => (
            <li key={entry.commandId}>
              <button
                aria-label={messages.historyViewDetail(
                  entry.summary,
                  originLabel(entry.origin),
                  entry.timestamp,
                )}
                aria-pressed={entry.commandId === selectedId}
                onClick={() => setSelectedId(entry.commandId)}
                type="button"
              >
                <span className={`history-origin-badge history-origin-${entry.origin}`}>
                  {originLabel(entry.origin)}
                </span>
                <span>{entry.summary}</span>
                <time dateTime={entry.timestamp}>{entry.timestamp}</time>
              </button>
            </li>
          ))}
        </ol>
      )}
      {selected && (
        <article aria-label={messages.historyEntryDetail} className="history-entry-detail">
          <h3>{selected.summary}</h3>
          <dl>
            <div><dt>{messages.historyKind}</dt><dd>{selected.kind}</dd></div>
            <div><dt>{messages.historyOrigin}</dt><dd>{originLabel(selected.origin)}</dd></div>
            <div><dt>{messages.historyTime}</dt><dd><time dateTime={selected.timestamp}>{selected.timestamp}</time></dd></div>
            <div><dt>{messages.historyUndoable}</dt><dd>{selected.undoable ? messages.historyUndoableYes : messages.historyUndoableNo}</dd></div>
          </dl>
          {detail?.kind === "source-diff" && (
            <section aria-label={detail.path} className="history-source-diff">
              <div><h4>{messages.historyBefore}</h4><pre>{detail.before}</pre></div>
              <div><h4>{messages.historyAfter}</h4><pre>{detail.after}</pre></div>
            </section>
          )}
        </article>
      )}
      <section aria-label={messages.mcpReviewPanel} className="mcp-pending-review-section">
        <h3>{messages.mcpReviewPanel}</h3>
        {pendingReviews.length === 0 ? <p>{messages.noMcpReviews}</p> : pendingReviews.map((review) => (
          <ReviewCard key={review.commandId} review={review} sourceForPath={sourceForPath} onApprove={onApprove} onDeny={onDeny} />
        ))}
      </section>
    </section>
  );
}
