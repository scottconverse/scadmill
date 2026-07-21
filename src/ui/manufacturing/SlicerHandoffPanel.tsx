import { useState } from "react";

import type { SlicerHandoffResult } from "../../application/manufacturing/slicer-handoff";
import { messages } from "../../messages/en";

export interface SlicerHandoffPanelProps {
  readonly multiObject?: boolean;
  readonly onOpen?: (configuredExecutablePath?: string) => Promise<SlicerHandoffResult>;
}

export function SlicerHandoffPanel({ multiObject = false, onOpen }: SlicerHandoffPanelProps) {
  const [configuredPath, setConfiguredPath] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SlicerHandoffResult>();
  const [failed, setFailed] = useState(false);
  const open = () => {
    if (!onOpen || running) return;
    setRunning(true); setFailed(false); setResult(undefined);
    const path = configuredPath.trim();
    void onOpen(path || undefined).then((next) => {
      setResult(next); setRunning(false);
    }, () => {
      setFailed(true); setRunning(false);
    });
  };
  return (
    <section>
      <h3>{messages.slicerHandoff}</h3>
      <p>{messages.slicerHandoffExplanation}</p>
      {!onOpen && <p role="status">{messages.slicerHandoffDesktopOnly}</p>}
      <label>
        <span>{messages.slicerExecutableOptional}</span>
        <input
          aria-label={messages.slicerExecutableOptional}
          disabled={!onOpen || running}
          onChange={(event) => setConfiguredPath(event.currentTarget.value)}
          placeholder={messages.slicerAutoDetect}
          type="text"
          value={configuredPath}
        />
      </label>
      <button disabled={!onOpen || running} onClick={open} type="button">
        {running ? messages.openingInSlicer : messages.openInSlicer}
      </button>
      {result && <p role="status">{messages.slicerOpened(result.slicerName)}</p>}
      {failed && <p className="manufacturing-error" role="alert">{messages.slicerHandoffFailed}</p>}
      {multiObject && <p role="note">{messages.slicerFilamentHonesty}</p>}
    </section>
  );
}
