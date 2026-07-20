import type { RenderState } from "../../application/runtime/workbench-runtime-contracts";

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
};

export function sameRenderStateExceptCached(left: RenderState, right: RenderState): boolean {
  return (Object.keys(MATERIAL_RENDER_KEYS) as MaterialRenderKey[])
    .every((key) => left[key] === right[key]);
}
