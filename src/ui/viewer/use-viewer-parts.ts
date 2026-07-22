import { useEffect, useState } from "react";

import type { RenderSuccess3D } from "../../application/engine/contracts";

export function useViewerParts(
  result: RenderSuccess3D | undefined,
  documentId: string,
  modelIdentity: string,
) {
  const [hiddenPartIds, setHiddenPartIds] = useState<ReadonlySet<string>>(new Set());
  const parts = result?.mesh.parts ?? [];
  const partIdentity = parts.map(({ id, color, triangleOffset, triangleCount }) =>
    `${id}:${color}:${triangleOffset}:${triangleCount}`
  ).join("|");
  useEffect(() => {
    void documentId;
    void modelIdentity;
    void partIdentity;
    setHiddenPartIds(new Set());
  }, [documentId, modelIdentity, partIdentity]);
  const partVisibility = Object.fromEntries(parts.map((part) => [part.id, !hiddenPartIds.has(part.id)]));
  const setPartVisibility = (partId: string, visible: boolean) => setHiddenPartIds((current) => {
    const next = new Set(current);
    if (visible) next.delete(partId);
    else next.add(partId);
    return next;
  });
  return { parts, partVisibility, setPartVisibility };
}
