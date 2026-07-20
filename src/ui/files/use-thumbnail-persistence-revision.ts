import { useEffect, useReducer } from "react";

import type { RenderThumbnailPersistence } from "../../application/render-cache/render-thumbnail-persistence";

export function useThumbnailPersistenceRevision(persistence: RenderThumbnailPersistence): void {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  useEffect(() => persistence.subscribe?.(() => refresh()), [persistence]);
}
