import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import { parseProjectPath } from "../../application/files/project-path";
import { ModelHistoryPanel } from "../history/ModelHistoryPanel";
import { useReadonlyStore } from "../use-readonly-store";
import { McpReviewPanel, type McpReviewPanelProps } from "./McpReviewPanel";

export interface HistoryActivityConnectorProps
  extends Omit<McpReviewPanelProps, "history" | "historyDetails"> {
  readonly runtime: Pick<
    WorkbenchRuntime,
    | "dispatch"
    | "documents"
    | "history"
    | "historyDetails"
    | "modelHistory"
    | "modelHistoryPersistence"
    | "project"
  >;
}

export function HistoryActivityConnector({ runtime, ...props }: HistoryActivityConnectorProps) {
  const history = useReadonlyStore(runtime.history, (state) => state);
  const historyDetails = useReadonlyStore(runtime.historyDetails, (state) => state);
  const modelHistory = useReadonlyStore(runtime.modelHistory, (state) => state);
  const modelHistoryPersistence = useReadonlyStore(
    runtime.modelHistoryPersistence,
    (state) => state,
  );
  const documents = useReadonlyStore(runtime.documents, (state) => state);
  const workspaceIdentity = useReadonlyStore(
    runtime.project,
    (state) => state.snapshot.workspaceIdentity,
  );
  const activeDocument = documents.documents.find(({ id }) => id === documents.activeDocumentId);
  const activeTimeline = modelHistory.filter((snapshot) => (
    snapshot.workspaceIdentity === workspaceIdentity
    && (
      snapshot.documentId === activeDocument?.id
      || (activeDocument && snapshot.documentPath === parseProjectPath(activeDocument.path))
    )
  ));

  return (
    <>
      {activeDocument ? (
        <ModelHistoryPanel
          currentSource={activeDocument.source}
          onPersistenceChange={(enabled) => runtime.dispatch({
            kind: "set-project-model-history-persistence",
            origin: "user",
            enabled,
          })}
          onRestore={(snapshotId) => runtime.dispatch({
              kind: "restore-model-history-snapshot",
              origin: "user",
              snapshotId,
            })}
          persistence={modelHistoryPersistence}
          snapshots={activeTimeline}
        />
      ) : null}
      <McpReviewPanel {...props} history={history} historyDetails={historyDetails} />
    </>
  );
}
