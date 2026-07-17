import { type RefObject, useCallback, useRef } from "react";

import type { ModelViewerHandle } from "./ModelViewer";

export function useViewerThumbnail(
  modelViewer: RefObject<ModelViewerHandle | null>,
  renderIdentity: string,
  onThumbnail?: (bytes: Uint8Array) => void | Promise<void>,
): () => void {
  const capturedIdentity = useRef<string | null>(null);
  return useCallback(() => {
    if (!onThumbnail || !renderIdentity || capturedIdentity.current === renderIdentity) return;
    void modelViewer.current?.captureThumbnailPng().then(async (bytes) => {
      if (capturedIdentity.current === renderIdentity) return;
      await onThumbnail(bytes);
      capturedIdentity.current = renderIdentity;
    }).catch(() => undefined);
  }, [modelViewer, onThumbnail, renderIdentity]);
}
