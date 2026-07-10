import { useMemo, useState } from "react";

import {
  formatConsoleHistory,
  type ConsoleLine,
  type ConsoleRun,
  type ConsoleState,
} from "../../application/diagnostics/console-state";
import type { Diagnostic } from "../../application/engine/contracts";
import { messages } from "../../messages/en";

type SeverityFilter = "all" | Diagnostic["severity"];

export interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

export interface DiagnosticConsoleProps {
  state: ConsoleState;
  emptyMessage: string;
  navigableJobId?: string;
  canNavigate?(diagnostic: Diagnostic): boolean;
  onNavigate?(diagnostic: Diagnostic): void;
  onClear(): void;
  clipboard?: ClipboardWriter;
}

const SEVERITIES: readonly SeverityFilter[] = [
  "all",
  "error",
  "warning",
  "echo",
  "trace",
  "info",
];

function outcome(run: ConsoleRun): string {
  if (run.status === "running") return messages.consoleRunning;
  if (run.status === "success") return messages.consoleExit(0);
  if (run.status === "engine-error" && run.exitCode !== undefined) {
    return messages.consoleExit(run.exitCode);
  }
  return messages.consoleOutcome(run.status);
}

function runLabel(run: ConsoleRun): string {
  const duration = run.durationMs === undefined
    ? messages.consolePendingDuration
    : messages.consoleDuration(run.durationMs);
  return `${run.entryFile} · ${run.quality} · ${duration} · ${outcome(run)}`;
}

function diagnosticSearchText(diagnostic: Diagnostic, entryFile: string): string {
  const location = `${diagnostic.file ?? entryFile}:${diagnostic.line ?? ""}`;
  return `${diagnostic.message} ${location}`.toLocaleLowerCase();
}

function visibleDiagnostic(
  diagnostic: Diagnostic,
  entryFile: string,
  severity: SeverityFilter,
  query: string,
): boolean {
  return (severity === "all" || diagnostic.severity === severity)
    && diagnosticSearchText(diagnostic, entryFile).includes(query);
}

function visibleLine(line: ConsoleLine, severity: SeverityFilter, query: string): boolean {
  return severity === "all" && line.raw.toLocaleLowerCase().includes(query);
}

function displayRaw(raw: string): string {
  return raw.replace(/(?:\r\n|\r|\n)$/u, "");
}

function keyedDiagnostics(diagnostics: readonly Diagnostic[]) {
  const counts = new Map<string, number>();
  return diagnostics.map((diagnostic) => {
    const base = [
      diagnostic.severity,
      diagnostic.message,
      diagnostic.file ?? "",
      diagnostic.line ?? "",
    ].join("|");
    const occurrence = counts.get(base) ?? 0;
    counts.set(base, occurrence + 1);
    return { diagnostic, key: `${base}|${occurrence}` };
  });
}

export function DiagnosticConsole({
  state,
  emptyMessage,
  navigableJobId,
  canNavigate,
  onNavigate,
  onClear,
  clipboard,
}: DiagnosticConsoleProps) {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [search, setSearch] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const visibleRuns = useMemo(() => state.runs.map((run) => ({
    run,
    diagnostics: run.diagnostics.filter((diagnostic) =>
      visibleDiagnostic(diagnostic, run.entryFile, severity, query)
    ),
    lines: run.lines.filter((line) => visibleLine(line, severity, query)),
  })), [query, severity, state.runs]);
  const hasMatches = visibleRuns.some(({ diagnostics, lines }) =>
    diagnostics.length > 0 || lines.length > 0
  );
  const waitingForOutput = severity === "all" && query.length === 0
    && visibleRuns.some(({ run, diagnostics, lines }) =>
      run.status === "running" && diagnostics.length === 0 && lines.length === 0
    );

  const copyAll = async () => {
    try {
      const writer = clipboard ?? globalThis.navigator?.clipboard;
      if (!writer) throw new Error("Clipboard unavailable");
      await writer.writeText(formatConsoleHistory(state));
      setCopyStatus(messages.consoleCopied);
    } catch {
      setCopyStatus(messages.consoleCopyFailed);
    }
  };

  return (
    <div className="diagnostic-console">
      <div className="console-toolbar">
        <label>
          <span>{messages.consoleSeverityFilter}</span>
          <select
            aria-label={messages.consoleSeverityFilter}
            onChange={(event) => setSeverity(event.currentTarget.value as SeverityFilter)}
            value={severity}
          >
            {SEVERITIES.map((value) => (
              <option key={value} value={value}>{messages.consoleSeverity(value)}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="visually-hidden">{messages.consoleSearch}</span>
          <input
            aria-label={messages.consoleSearch}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={messages.consoleSearch}
            type="search"
            value={search}
          />
        </label>
        <button onClick={() => void copyAll()} type="button">{messages.consoleCopyAll}</button>
        <button onClick={onClear} type="button">{messages.consoleClear}</button>
        {copyStatus && <span role="status">{copyStatus}</span>}
      </div>

      {state.runs.length === 0 && <p>{emptyMessage}</p>}
      {waitingForOutput && <p>{messages.consoleWaiting}</p>}
      {state.runs.length > 0 && !hasMatches && !waitingForOutput && (
        <p>{messages.consoleNoMatches}</p>
      )}
      {visibleRuns.map(({ run, diagnostics, lines }) => (
        <section className="console-run" key={run.jobId} aria-label={runLabel(run)}>
          <h3 className="console-run-separator">{runLabel(run)}</h3>
          {run.droppedLineCount > 0 && (
            <p className="console-dropped-lines">{messages.consoleLinesDropped(run.droppedLineCount)}</p>
          )}
          {diagnostics.length > 0 && (
            <ul aria-label={messages.renderDiagnostics} className="console-diagnostics">
              {keyedDiagnostics(diagnostics).map(({ diagnostic, key }) => {
                const path = diagnostic.file ?? run.entryFile;
                const navigable = run.jobId === navigableJobId
                  && Boolean(onNavigate && canNavigate?.(diagnostic));
                const content = (
                  <>
                    <span className="console-diagnostic-severity" data-severity={diagnostic.severity}>
                      {diagnostic.severity}
                    </span>
                    <span data-severity={diagnostic.severity}>{diagnostic.message}</span>
                    {diagnostic.line && (
                      <span className="console-diagnostic-location">
                        {messages.diagnosticLocation(path, diagnostic.line)}
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={key}>
                    {navigable && diagnostic.line
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
          {lines.length > 0 && (
            <ol aria-label={messages.rawEngineOutput} className="console-log">
              {lines.map((line) => (
                <li key={`${line.sequence}-${line.part}`}>
                  <span className="console-line-time">+{(line.elapsedMs / 1000).toFixed(3)}s</span>
                  <span className="console-line-stream">{line.stream}</span>
                  <span className="console-line-raw">{displayRaw(line.raw)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}
