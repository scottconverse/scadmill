import { useEffect, useState } from "react";

import { messages } from "../../messages/en";

export interface RenderProgressOverlayProps {
  readonly onCancel?: () => void;
}

export function RenderProgressOverlay({ onCancel }: RenderProgressOverlayProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    let active = true;
    const started = globalThis.performance?.now?.() ?? Date.now();
    const update = () => {
      if (!active) return;
      const current = globalThis.performance?.now?.() ?? Date.now();
      setElapsedSeconds(Math.max(0, current - started) / 1_000);
    };
    update();
    const timer = globalThis.setInterval(update, 100);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, []);

  return (
    <div aria-label={messages.renderProgress} className="viewer-render-overlay" role="status">
      <span aria-hidden="true" className="viewer-spinner">◌</span>
      <span>{messages.renderingElapsed(elapsedSeconds)}</span>
      <button aria-label={messages.cancelRender} onClick={onCancel} type="button">
        {messages.cancelRender}
      </button>
    </div>
  );
}
