import { useCallback, useState } from "react";

import type { ParameterDocumentState } from "../../application/parameters/parameter-state";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";
import { ParameterPanel } from "./ParameterPanel";

export interface ParameterPanelConnectorProps {
  readonly documentId: string;
  readonly runtime: WorkbenchRuntime;
  readonly state: ParameterDocumentState;
}

export function ParameterPanelConnector({
  documentId,
  runtime,
  state,
}: ParameterPanelConnectorProps) {
  const [error, setError] = useState<string>();
  const run = useCallback((command: Parameters<typeof runtime.dispatch>[0]) => {
    setError(undefined);
    void runtime.dispatch(command).catch(() => {
      setError(messages.parameterCommandFailed(messages.unknownParameterCommandError));
    });
  }, [runtime]);

  return (
    <>
      {error && <p role="alert">{error}</p>}
      <ParameterPanel
        artifactDestination={runtime.artifacts}
        documentId={documentId}
        state={state}
        onAction={(action) => run({ kind: "update-parameters", origin: "user", action })}
        onWrite={() => run({
          kind: "write-parameter-values",
          origin: "user",
          documentId,
        })}
      />
    </>
  );
}
