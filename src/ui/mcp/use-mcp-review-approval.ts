import { useCallback } from "react";

import type { McpPendingReview } from "../../application/mcp/mcp-review-queue";
import type { ParameterValue } from "../../application/parameters/customizer-schema";
import type { ProjectSessionState } from "../../application/files/project-session";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import type { DocumentWorkspaceState } from "../../application/documents/document-workspace";

export function useMcpReviewApproval(
  runtime: WorkbenchRuntime,
  documents: DocumentWorkspaceState,
  project: ProjectSessionState,
  approveReview: (commandId: string) => McpPendingReview | undefined,
) {
  const sourceForPath = useCallback((path: string) => {
    const open = documents.documents.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase());
    if (open) return open.source;
    const snapshot = [...project.snapshot.files.entries()].find(([candidate]) => candidate.toLowerCase() === path.toLowerCase())?.[1];
    return typeof snapshot === "string" ? snapshot : "";
  }, [documents.documents, project.snapshot.files]);

  const approve = useCallback(async (review: McpPendingReview) => {
    const path = typeof review.arguments.path === "string" ? review.arguments.path : "";
    if (!path) throw new Error("The MCP review has no project path.");
    let target = documents.documents.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase());
    if (review.tool === "write_file") {
      const source = typeof review.arguments.content === "string" ? review.arguments.content : "";
      if (!target) {
        const existing = [...project.snapshot.files.entries()].find(([candidate]) => candidate.toLowerCase() === path.toLowerCase())?.[1];
        if (existing === undefined) {
          if (review.arguments.createIfMissing !== true) throw new Error(`Project file ${path} no longer exists.`);
          await runtime.dispatch({ kind: "create-project-file", origin: "external-agent", path, source });
        } else {
          if (typeof existing !== "string") throw new Error(`Project file ${path} is not text.`);
          await runtime.dispatch({ kind: "open-project-file", origin: "external-agent", path });
          target = runtime.documents.getState().documents.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase());
          if (!target) throw new Error(`Project file ${path} could not be opened for review.`);
          await runtime.dispatch({ kind: "edit-document", origin: "external-agent", documentId: target.id, source });
        }
      } else {
        await runtime.dispatch({ kind: "edit-document", origin: "external-agent", documentId: target.id, source });
      }
    } else {
      if (!target) {
        await runtime.dispatch({ kind: "open-project-file", origin: "external-agent", path });
        target = runtime.documents.getState().documents.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase());
      }
      if (!target) throw new Error(`Project file ${path} could not be opened for parameter review.`);
      await runtime.dispatch({
        kind: "update-parameters",
        origin: "external-agent",
        action: { kind: "set-values", documentId: target.id, values: review.arguments.values as Readonly<Record<string, ParameterValue>> },
      });
    }
    if (!approveReview(review.commandId)) throw new Error("This MCP review is no longer pending.");
  }, [approveReview, documents.documents, project.snapshot.files, runtime]);

  return { sourceForPath, approve };
}
