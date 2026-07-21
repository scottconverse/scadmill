import { useEffect, useRef, useState } from "react";

import type {
  ModelHistoryPersistenceState,
  ModelHistorySnapshot,
} from "../../application/model-history/model-history";
import { thumbnailDataUrl } from "../../application/render-cache/render-thumbnail-persistence";
import { messages } from "../../messages/en";
import { ExternalChangeDiff } from "../files/ExternalChangeDiff";
import "./model-history-panel.css";

export interface ModelHistoryPanelProps {
  readonly currentSource: string;
  readonly snapshots: readonly ModelHistorySnapshot[];
  readonly onRestore: (snapshotId: string) => void | Promise<void>;
  readonly persistence?: ModelHistoryPersistenceState;
  readonly onPersistenceChange?: (enabled: boolean) => void | Promise<void>;
}

export function ModelHistoryPanel({
  currentSource,
  snapshots,
  onRestore,
  persistence,
  onPersistenceChange,
}: ModelHistoryPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, snapshots.length - 1));
  const followsLatest = useRef(true);
  const [restoreError, setRestoreError] = useState<string>();
  const [restoring, setRestoring] = useState(false);
  const [persistencePending, setPersistencePending] = useState(false);
  useEffect(() => {
    setSelectedIndex((current) => followsLatest.current
      ? Math.max(0, snapshots.length - 1)
      : Math.min(current, Math.max(0, snapshots.length - 1)));
  }, [snapshots.length]);
  const selected = snapshots[selectedIndex];
  const position = selectedIndex + 1;

  return (
    <section aria-label={messages.modelHistory} className="model-history-panel">
      <h2>{messages.modelHistory}</h2>
      {persistence?.supported && onPersistenceChange ? (
        <label className="model-history-persistence">
          <input
            checked={persistence.enabled}
            disabled={persistencePending}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setPersistencePending(true);
              void Promise.resolve(onPersistenceChange(enabled)).finally(() => {
                setPersistencePending(false);
              });
            }}
            type="checkbox"
          />
          {messages.modelHistoryKeepForProject}
        </label>
      ) : null}
      {persistence?.status === "error" ? (
        <p className="model-history-error" role="alert">
          {messages.modelHistoryPersistenceFailed}
        </p>
      ) : null}
      {!selected ? <p>{messages.modelHistoryEmpty}</p> : (
        <>
          <label className="model-history-scrubber">
            <span>{messages.modelHistorySnapshot}</span>
            <input
              aria-label={messages.modelHistorySnapshot}
              aria-valuetext={messages.modelHistorySnapshotPosition(position, snapshots.length)}
              max={snapshots.length - 1}
              min={0}
              onChange={(event) => {
                const index = Number(event.currentTarget.value);
                followsLatest.current = index === snapshots.length - 1;
                setSelectedIndex(index);
              }}
              step={1}
              type="range"
              value={selectedIndex}
            />
            <strong>{messages.modelHistorySnapshotPosition(position, snapshots.length)}</strong>
          </label>
          <article className="model-history-detail">
            <header>
              <div>
                <strong>{selected.documentPath}</strong>
                <time dateTime={selected.capturedAt}>{selected.capturedAt}</time>
              </div>
              <span>{selected.quality}</span>
            </header>
            {selected.thumbnailPng ? (
              <img
                alt={messages.modelHistoryPreview(position, snapshots.length)}
                className="model-history-thumbnail"
                src={thumbnailDataUrl(selected.thumbnailPng)}
              />
            ) : <div className="model-history-thumbnail-empty">{messages.modelHistoryEmpty}</div>}
            <section
              aria-label={messages.modelHistorySourceComparison}
              className="model-history-source-diff"
            >
              <ExternalChangeDiff
                afterLabel={messages.modelHistorySnapshotSource}
                beforeLabel={messages.modelHistoryCurrentSource}
                diskSource={selected.source}
                localSource={currentSource}
                onApply={() => undefined}
                reviewOnly
              />
            </section>
            <details>
              <summary>{messages.modelHistoryParameters}</summary>
              <pre>{JSON.stringify(selected.parameters, null, 2)}</pre>
            </details>
            <button
              disabled={restoring}
              onClick={() => {
                setRestoreError(undefined);
                setRestoring(true);
                void Promise.resolve(onRestore(selected.snapshotId))
                  .catch((error: unknown) => {
                    setRestoreError(error instanceof Error
                      ? error.message
                      : messages.modelHistoryRestoreFailed);
                  })
                  .finally(() => setRestoring(false));
              }}
              type="button"
            >
              {messages.modelHistoryRestore(position)}
            </button>
            {restoreError ? (
              <p className="model-history-error" role="alert">{restoreError}</p>
            ) : null}
          </article>
        </>
      )}
    </section>
  );
}
