import { useCallback } from "react";

import type { McpPendingReview } from "../../application/mcp/mcp-review-queue";
import { applyWorkbenchReview } from "../../application/mcp/apply-workbench-review";
import type { ProjectSessionState } from "../../application/files/project-session";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import type { DocumentWorkspaceState } from "../../application/documents/document-workspace";

export function useMcpReviewApproval(
  runtime: WorkbenchRuntime,
  documents: DocumentWorkspaceState,
  project: ProjectSessionState,
  claimReview: (commandId: string) => McpPendingReview | undefined,
  restoreReview: (review: McpPendingReview) => void,
) {
  const sourceForPath = useCallback((path: string) => {
    const open = documents.documents.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase());
    if (open) return open.source;
    const snapshot = [...project.snapshot.files.entries()].find(([candidate]) => candidate.toLowerCase() === path.toLowerCase())?.[1];
    return typeof snapshot === "string" ? snapshot : "";
  }, [documents.documents, project.snapshot.files]);

  const approve = useCallback(async (review: McpPendingReview) => {
    const claimed = claimReview(review.commandId);
    if (!claimed || claimed.origin !== review.origin || claimed.tool !== review.tool) {
      throw new Error("This tool review is no longer pending.");
    }
    try {
      await applyWorkbenchReview(runtime, review, review.origin);
    } catch (reason) {
      restoreReview(review);
      throw reason;
    }
  }, [claimReview, restoreReview, runtime]);

  return { sourceForPath, approve };
}
