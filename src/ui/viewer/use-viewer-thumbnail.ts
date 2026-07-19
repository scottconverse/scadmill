import { type RefObject, useCallback, useRef } from "react";

import type { ModelViewerHandle } from "./ModelViewer";

export function useViewerThumbnail(
  modelViewer: RefObject<ModelViewerHandle | null>,
  renderIdentity: string,
  persistenceDestination: string,
  onThumbnail?: (bytes: Uint8Array) => void | Promise<void>,
): () => void {
  const captureIdentity = JSON.stringify([persistenceDestination, renderIdentity]);
  const capturedIdentity = useRef<string | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const captureLatest = useRef<() => void>(() => undefined);
  const lastIdentity = useRef<string | null>(null);
  if (lastIdentity.current !== captureIdentity) {
    lastIdentity.current = captureIdentity;
    generation.current += 1;
    capturedIdentity.current = null;
  }
  const capture = useCallback(() => {
    if (!onThumbnail || !renderIdentity || capturedIdentity.current === captureIdentity) return;
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    const captureGeneration = generation.current;
    inFlight.current = true;
    void modelViewer.current?.captureThumbnailPng().then(async (bytes) => {
      if (generation.current !== captureGeneration || capturedIdentity.current === captureIdentity) return;
      await onThumbnail(bytes);
      capturedIdentity.current = captureIdentity;
    }).catch(() => undefined).finally(() => {
      inFlight.current = false;
      if (!pending.current) return;
      pending.current = false;
      captureLatest.current();
    });
  }, [captureIdentity, modelViewer, onThumbnail, renderIdentity]);
  captureLatest.current = capture;
  return capture;
}
