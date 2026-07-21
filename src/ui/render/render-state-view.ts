import type { RenderResult } from "../../application/engine/contracts";
import type { RenderState } from "../../application/runtime/workbench-runtime-contracts";
import type { ViewerMode } from "../../application/viewer/viewer-state";

type MaterialRenderKey = Exclude<keyof RenderState, "cached">;

const MATERIAL_RENDER_KEYS: { readonly [Key in MaterialRenderKey]: true } = {
  status: true,
  jobId: true,
  startedAtMs: true,
  startedAtMonotonicMs: true,
  quality: true,
  documentId: true,
  entryFile: true,
  sourceRevision: true,
  sourceFiles: true,
  projectRevision: true,
  parameterValues: true,
  result: true,
  presentationToken: true,
};

export function sameRenderStateExceptCached(left: RenderState, right: RenderState): boolean {
  return (Object.keys(MATERIAL_RENDER_KEYS) as MaterialRenderKey[])
    .every((key) => left[key] === right[key]);
}

export function presentationHiddenByMode(result: RenderResult | undefined, mode: ViewerMode): boolean {
  return (result?.kind === "2d" || result?.kind === "3d") && mode !== "auto" && result.kind !== mode;
}

export function activePresentationToken(render: RenderState, activeDocumentId: string, stale: boolean): string | undefined {
  return render.status === "success"
    && render.documentId === activeDocumentId
    && !stale
    && (render.result?.kind === "2d" || render.result?.kind === "3d")
    ? render.presentationToken
    : undefined;
}
