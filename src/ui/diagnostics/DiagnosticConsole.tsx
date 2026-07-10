import type { Diagnostic } from "../../application/engine/contracts";
import { messages } from "../../messages/en";

export interface DiagnosticConsoleProps {
  diagnostics?: readonly Diagnostic[];
  entryFile?: string;
  emptyMessage: string;
  canNavigate?(diagnostic: Diagnostic): boolean;
  onNavigate?(diagnostic: Diagnostic): void;
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
  entryFile,
  emptyMessage,
  canNavigate,
  onNavigate,
  rawLog,
}: DiagnosticConsoleProps) {
  if (diagnostics.length === 0 && rawLog.length === 0) {
    return <p>{emptyMessage}</p>;
  }
  return (
    <>
      {diagnostics.length > 0 && (
        <ul aria-label={messages.renderDiagnostics} className="console-diagnostics">
          {diagnosticRows(diagnostics).map(({ diagnostic, key }) => {
            const path = diagnostic.file ?? entryFile;
            const navigable = Boolean(
              onNavigate
              && path
              && diagnostic.line
              && canNavigate?.(diagnostic),
            );
            const content = (
              <>
                <span className="console-diagnostic-severity" data-severity={diagnostic.severity}>
                  {diagnostic.severity}
                </span>
                <span className="console-diagnostic-message">{diagnostic.message}</span>
                {path && diagnostic.line && (
                  <span className="console-diagnostic-location">
                    {messages.diagnosticLocation(path, diagnostic.line)}
                  </span>
                )}
              </>
            );
            return (
              <li key={key}>
                {navigable && path && diagnostic.line
                  ? (
                      <button
                        aria-label={messages.goToDiagnostic(
                          diagnostic.message,
                          path,
                          diagnostic.line,
                        )}
                        className="console-diagnostic"
                        onClick={() => onNavigate?.(diagnostic)}
                        type="button"
                      >
                        {content}
                      </button>
                    )
                  : <div className="console-diagnostic">{content}</div>}
              </li>
            );
          })}
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
