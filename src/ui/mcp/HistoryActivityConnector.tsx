import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime-contracts";
import { useReadonlyStore } from "../use-readonly-store";
import { McpReviewPanel, type McpReviewPanelProps } from "./McpReviewPanel";

export interface HistoryActivityConnectorProps
  extends Omit<McpReviewPanelProps, "history" | "historyDetails"> {
  readonly runtime: Pick<WorkbenchRuntime, "history" | "historyDetails">;
}

export function HistoryActivityConnector({ runtime, ...props }: HistoryActivityConnectorProps) {
  const history = useReadonlyStore(runtime.history, (state) => state);
  const historyDetails = useReadonlyStore(runtime.historyDetails, (state) => state);
  return <McpReviewPanel {...props} history={history} historyDetails={historyDetails} />;
}
