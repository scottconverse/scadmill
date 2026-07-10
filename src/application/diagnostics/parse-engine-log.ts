import type { Diagnostic } from "../engine/contracts";

export interface EngineLogLine {
  raw: string;
  diagnostic?: Diagnostic;
}

export interface ParsedEngineLog {
  diagnostics: Diagnostic[];
  lines: readonly EngineLogLine[];
}

export interface ParseEngineLogOptions {
  resolveFile?(reportedFile: string): string | undefined;
}

const DIAGNOSTIC_PREFIX = /^(ERROR|WARNING|ECHO|TRACE):\s?(.*)$/u;
const SOURCE_LOCATION = /\s+in file\s+(.+),\s+line\s+(\d+)\s*$/u;

function parseDiagnostic(
  raw: string,
  options: ParseEngineLogOptions,
): Diagnostic | undefined {
  const match = DIAGNOSTIC_PREFIX.exec(raw);
  if (!match) return undefined;

  const message = match[2];
  const location = SOURCE_LOCATION.exec(message);
  const line = location ? Number.parseInt(location[2], 10) : undefined;
  const file = location
    ? (options.resolveFile ? options.resolveFile(location[1]) : location[1])
    : undefined;
  const severity = match[1].toLowerCase() as Diagnostic["severity"];
  return {
    severity,
    message,
    ...(file ? { file } : {}),
    ...(line && line > 0 ? { line } : {}),
  };
}

function rawLines(rawLog: string): string[] {
  if (rawLog.length === 0) return [];
  const lines = rawLog.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function parseEngineLog(
  rawLog: string,
  options: ParseEngineLogOptions = {},
): ParsedEngineLog {
  const diagnostics: Diagnostic[] = [];
  const lines = rawLines(rawLog).map((raw) => {
    const diagnostic = parseDiagnostic(raw, options);
    if (diagnostic) diagnostics.push(diagnostic);
    return diagnostic ? { raw, diagnostic } : { raw };
  });
  return { diagnostics, lines };
}
