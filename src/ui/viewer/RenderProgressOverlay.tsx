import { useEffect, useRef, useState } from "react";

import { messages } from "../../messages/en";

export interface RenderProgressOverlayProps {
  readonly onCancel?: () => void;
  readonly startedAtMonotonicMs?: number;
  readonly startedAtMs?: number;
}

export function RenderProgressOverlay({
  onCancel,
  startedAtMonotonicMs,
  startedAtMs,
}: RenderProgressOverlayProps) {
  const mountedAt = useRef({ monotonicMs: performance.now(), wallMs: Date.now() });
  const monotonicOrigin = startedAtMonotonicMs ?? mountedAt.current.monotonicMs;
  const wallOrigin = startedAtMs ?? mountedAt.current.wallMs;
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    Math.max(0, startedAtMonotonicMs === undefined
      ? Date.now() - wallOrigin
      : performance.now() - monotonicOrigin) / 1_000
  );

  useEffect(() => {
    let active = true;
    const elapsedAtMountMs = Math.max(0, startedAtMonotonicMs === undefined
      ? Date.now() - wallOrigin
      : performance.now() - monotonicOrigin);
    const monotonicStartedAtMs = performance.now();
    const update = () => {
      if (!active) return;
      const elapsedSinceMountMs = Math.max(0, performance.now() - monotonicStartedAtMs);
      setElapsedSeconds((elapsedAtMountMs + elapsedSinceMountMs) / 1_000);
    };
    update();
    const timer = globalThis.setInterval(update, 100);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [monotonicOrigin, startedAtMonotonicMs, wallOrigin]);

  return (
    <fieldset className="viewer-render-overlay">
      <legend className="visually-hidden">{messages.renderProgress}</legend>
      <span aria-hidden="true" className="viewer-spinner" />
      <span>{messages.renderingElapsed(elapsedSeconds)}</span>
      <span className="visually-hidden" role="status">{messages.rendering}</span>
      <button aria-label={messages.cancelRender} onClick={onCancel} type="button">
        {messages.cancelRender}
      </button>
    </fieldset>
  );
}
