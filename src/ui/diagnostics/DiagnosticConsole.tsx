import type { Diagnostic } from "../../application/engine/contracts";
import { messages } from "../../messages/en";

export interface DiagnosticConsoleProps {
  diagnostics?: readonly Diagnostic[];
  emptyMessage: string;
  rawLog: string;
}

function diagnosticRows(diagnostics: readonly Diagnostic[]) {
  const occurrences = new Map<string, number>();
  return diagnostics.map((diagnostic) => {
    const identity = [
      diagnostic.file ?? "",
      diagnostic.line ?? "",
      diagnostic.severity,
      diagnostic.message,
    ].join(":");
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return { diagnostic, key: `${identity}:${occurrence}` };
  });
}

export function DiagnosticConsole({
  diagnostics = [],
  emptyMessage,
  rawLog,
}: DiagnosticConsoleProps) {
  if (diagnostics.length === 0 && rawLog.length === 0) {
    return <p>{emptyMessage}</p>;
  }
  return (
    <>
      {diagnostics.length > 0 && (
        <ul aria-label={messages.renderDiagnostics} className="console-diagnostics">
          {diagnosticRows(diagnostics).map(({ diagnostic, key }) => (
            <li key={key}>
              <span className="console-diagnostic-severity" data-severity={diagnostic.severity}>
                {diagnostic.severity}
              </span>
              <span>{diagnostic.message}</span>
            </li>
          ))}
        </ul>
      )}
      {rawLog.length > 0 && (
        <section aria-label={messages.rawEngineOutput}>
          <pre className="console-log">{rawLog}</pre>
        </section>
      )}
    </>
  );
}
