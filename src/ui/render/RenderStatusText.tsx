import type { RenderState } from "../../application/runtime/workbench-runtime-contracts";
import type { ReadonlyStore } from "../../application/runtime/workbench-runtime-contracts";
import { useReadonlyStore } from "../use-readonly-store";
import { renderStatusLabel } from "../workbench-status";

export interface RenderStatusTextProps {
  readonly documentPath: string;
  readonly renderStore: ReadonlyStore<RenderState>;
  readonly stale: boolean;
}

export function RenderStatusText({ documentPath, renderStore, stale }: RenderStatusTextProps) {
  const render = useReadonlyStore(renderStore, (state) => state);
  return renderStatusLabel(render, stale, documentPath);
}
