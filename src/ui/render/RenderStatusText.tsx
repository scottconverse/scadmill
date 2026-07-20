import type { RenderState } from "../../application/runtime/workbench-runtime-contracts";
import type { ReadonlyStore } from "../../application/runtime/workbench-runtime-contracts";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";
import type { PresentationStatus } from "../viewer/use-presentation-readiness";
import { renderStatusLabel } from "../workbench-status";

export interface RenderStatusTextProps {
  readonly documentPath: string;
  readonly presentationStatus?: PresentationStatus | "withheld";
  readonly renderStore: ReadonlyStore<RenderState>;
  readonly stale: boolean;
}

export function RenderStatusText({ documentPath, presentationStatus = "ready", renderStore, stale }: RenderStatusTextProps) {
  const render = useReadonlyStore(renderStore, (state) => state);
  if (render.status === "success" && presentationStatus === "presenting") {
    return messages.presentingDocument(render.entryFile ?? documentPath);
  }
  if (render.status === "success" && presentationStatus === "failed") {
    return messages.presentationFailedDocument(render.entryFile ?? documentPath);
  }
  if (render.status === "success" && presentationStatus === "withheld") {
    return messages.renderCompletedNotDisplayed(
      render.entryFile ?? documentPath,
      render.result?.kind ?? "geometry",
      Boolean(render.cached),
      stale,
    );
  }
  if (render.status === "success" && presentationStatus === "skipped") {
    return `${renderStatusLabel(render, stale, documentPath)} - ${messages.presentationHiddenByMode}`;
  }
  return renderStatusLabel(render, stale, documentPath);
}
