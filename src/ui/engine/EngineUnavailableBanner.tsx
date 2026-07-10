import { useEffect, useState } from "react";

import { messages } from "../../messages/en";

export interface EngineUnavailableBannerProps {
  configuredPath: string;
  state: EngineRecoveryState;
  onSave(path: string): void;
}

export type EngineRecoveryState =
  | { kind: "unavailable" }
  | { kind: "checking"; path: string }
  | { kind: "invalid-config"; path: string };

export function EngineUnavailableBanner({
  configuredPath,
  state,
  onSave,
}: EngineUnavailableBannerProps) {
  const [editing, setEditing] = useState(state.kind !== "unavailable");
  const [path, setPath] = useState(configuredPath);
  const checking = state.kind === "checking";
  const reportedPath = state.kind === "unavailable" ? null : state.path;
  useEffect(() => {
    if (reportedPath === null) return;
    setEditing(true);
    setPath(reportedPath);
  }, [reportedPath]);

  return (
    <div aria-busy={checking} aria-live="polite" className="engine-banner" role="status">
      <span>
        {state.kind === "unavailable"
          ? messages.engineUnavailable
          : state.kind === "checking"
            ? messages.checkingConfiguredEngine
            : messages.engineConfiguredPathRejected}
      </span>
      {state.kind === "invalid-config" && (
        <span className="engine-rejected-path">{messages.engineRejectedPath(state.path)}</span>
      )}
      {!editing
        ? (
            <button onClick={() => setEditing(true)} type="button">
              {messages.fixEngine}
            </button>
          )
        : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSave(path.trim());
              }}
            >
              <label>
                <span>{messages.engineExecutablePath}</span>
                <input
                  aria-label={messages.engineExecutablePath}
                  disabled={checking}
                  onChange={(event) => setPath(event.currentTarget.value)}
                  value={path}
                />
              </label>
              <button disabled={checking} type="submit">
                {checking ? messages.checkingEngineAction : messages.saveEnginePath}
              </button>
            </form>
          )}
    </div>
  );
}
