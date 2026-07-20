import { type RefObject, useCallback, useEffect, useRef } from "react";

import type { ModelViewerHandle } from "./ModelViewer";

const AUTOMATIC_THUMBNAIL_DELAY_MS = 250;

interface ThumbnailCaptureRequest {
  generation: number;
  identity: string;
  persist(bytes: Uint8Array): void | Promise<void>;
}

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
  const pending = useRef<ThumbnailCaptureRequest | null>(null);
  const scheduled = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRequestRef = useRef<(request: ThumbnailCaptureRequest) => void>(() => undefined);
  const lastIdentity = useRef<string | null>(null);
  if (lastIdentity.current !== captureIdentity) {
    lastIdentity.current = captureIdentity;
    generation.current += 1;
    capturedIdentity.current = null;
  }

  const startRequest = useCallback((request: ThumbnailCaptureRequest) => {
    if (
      generation.current !== request.generation
      || capturedIdentity.current === request.identity
    ) return;
    const viewer = modelViewer.current;
    if (!viewer) return;

    inFlight.current = true;
    void viewer.captureThumbnailPng().then(async (bytes) => {
      if (
        generation.current !== request.generation
        || capturedIdentity.current === request.identity
      ) return;
      await request.persist(bytes);
      if (generation.current === request.generation) capturedIdentity.current = request.identity;
    }).catch(() => undefined).finally(() => {
      inFlight.current = false;
      const next = pending.current;
      pending.current = null;
      if (next) startRequestRef.current(next);
    });
  }, [modelViewer]);
  startRequestRef.current = startRequest;

  useEffect(() => () => {
    if (scheduled.current !== null) clearTimeout(scheduled.current);
    scheduled.current = null;
    pending.current = null;
  }, []);

  return useCallback(() => {
    if (!onThumbnail || !renderIdentity || capturedIdentity.current === captureIdentity) return;

    const request: ThumbnailCaptureRequest = {
      generation: generation.current,
      identity: captureIdentity,
      persist: onThumbnail,
    };
    pending.current = null;
    if (scheduled.current !== null) clearTimeout(scheduled.current);
    scheduled.current = setTimeout(() => {
      scheduled.current = null;
      if (
        generation.current !== request.generation
        || capturedIdentity.current === request.identity
      ) return;
      if (inFlight.current) {
        pending.current = request;
        return;
      }
      startRequestRef.current(request);
    }, AUTOMATIC_THUMBNAIL_DELAY_MS);
  }, [captureIdentity, onThumbnail, renderIdentity]);
}
