import type { CommandOrigin, WorkbenchRuntime } from "../runtime/workbench-runtime-contracts";
import type { ParameterValue } from "../parameters/customizer-schema";
import type { McpPendingReview } from "./mcp-review-queue";

type ReviewOrigin = Extract<CommandOrigin, "ai-panel" | "external-agent">;

export async function applyWorkbenchReview(
  runtime: WorkbenchRuntime,
  review: McpPendingReview,
  origin: ReviewOrigin,
): Promise<void> {
  const path = typeof review.arguments.path === "string" ? review.arguments.path : "";
  if (!path) throw new Error("The tool review has no project path.");
  const findTarget = () => runtime.documents.getState().documents.find(
    (candidate) => candidate.path.toLowerCase() === path.toLowerCase(),
  );
  let target = findTarget();
  if (review.tool === "write_file") {
    const source = typeof review.arguments.content === "string" ? review.arguments.content : "";
    if (!target) {
      const existing = [...runtime.project.getState().snapshot.files.entries()].find(
        ([candidate]) => candidate.toLowerCase() === path.toLowerCase(),
      )?.[1];
      if (existing === undefined) {
        if (review.arguments.createIfMissing !== true) throw new Error(`Project file ${path} no longer exists.`);
        await runtime.dispatch({ kind: "create-project-file", origin, path, source });
        return;
      }
      if (typeof existing !== "string") throw new Error(`Project file ${path} is not text.`);
      await runtime.dispatch({ kind: "open-project-file", origin, path });
      target = findTarget();
      if (!target) throw new Error(`Project file ${path} could not be opened for review.`);
    }
    await runtime.dispatch({ kind: "edit-document", origin, documentId: target.id, source });
    return;
  }
  if (!target) {
    await runtime.dispatch({ kind: "open-project-file", origin, path });
    target = findTarget();
  }
  if (!target) throw new Error(`Project file ${path} could not be opened for review.`);
  await runtime.dispatch({
    kind: "update-parameters",
    origin,
    action: {
      kind: "set-values",
      documentId: target.id,
      values: review.arguments.values as Readonly<Record<string, ParameterValue>>,
    },
  });
}
