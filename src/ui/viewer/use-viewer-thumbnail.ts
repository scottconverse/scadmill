import { type RefObject, useCallback, useRef } from "react";

import type { ModelViewerHandle } from "./ModelViewer";

export function useViewerThumbnail(
  modelViewer: RefObject<ModelViewerHandle | null>,
  renderIdentity: string,
  onThumbnail?: (bytes: Uint8Array) => void | Promise<void>,
): () => void {
  const capturedIdentity = useRef<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const lastIdentity = useRef<string | null>(null);
  if (lastIdentity.current !== renderIdentity) {
    lastIdentity.current = renderIdentity;
    generation.current += 1;
    capturedIdentity.current = null;
  }
  return useCallback(() => {
    if (!onThumbnail || !renderIdentity || capturedIdentity.current === renderIdentity || inFlight.current) return;
    const captureGeneration = generation.current;
    inFlight.current = true;
    void modelViewer.current?.captureThumbnailPng().then(async (bytes) => {
      if (generation.current !== captureGeneration || capturedIdentity.current === renderIdentity) return;
      await onThumbnail(bytes);
      capturedIdentity.current = renderIdentity;
    }).catch(() => undefined).finally(() => { inFlight.current = false; });
  }, [modelViewer, onThumbnail, renderIdentity]);
}
