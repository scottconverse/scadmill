import type {
  Diagnostic,
  EngineOutputEvent,
  Quality,
  RenderFailure,
  RenderResult,
  RenderStats,
} from "../engine/contracts";

export const CONSOLE_LINE_LIMIT = 10_000;

export interface ConsoleLine {
  sequence: number;
  part: number;
  elapsedMs: number;
  stream: EngineOutputEvent["stream"] | "unknown";
  raw: string;
}

export interface ConsoleRun {
  jobId: string;
  entryFile: string;
  quality: Quality;
  startedAt: string;
  status: "running" | "success" | RenderFailure["reason"];
  durationMs?: number;
  exitCode?: number;
  stats?: RenderStats;
  diagnostics: readonly Diagnostic[];
  lines: readonly ConsoleLine[];
  droppedLineCount: number;
  rawLogFallbackSuppressed?: boolean;
}

export interface ConsoleState {
  runs: readonly ConsoleRun[];
  retainedLineCount: number;
}

export type ConsoleAction =
  | {
      kind: "start-run";
      jobId: string;
      entryFile: string;
      quality: Quality;
      startedAt: string;
    }
  | { kind: "append-output"; jobId: string; event: EngineOutputEvent }
  | { kind: "finish-run"; jobId: string; durationMs: number; result: RenderResult }
  | { kind: "clear" };

export function createConsoleState(): ConsoleState {
  return { runs: [], retainedLineCount: 0 };
}

function splitRaw(raw: string): string[] {
  return raw.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/gu) ?? [];
}

function eventLines(event: EngineOutputEvent): ConsoleLine[] {
  return splitRaw(event.raw).map((raw, part) => ({ ...event, part, raw }));
}

function capLines(runs: readonly ConsoleRun[]): ConsoleState {
  const retainedLineCount = runs.reduce((count, run) => count + run.lines.length, 0);
  let overflow = Math.max(0, retainedLineCount - CONSOLE_LINE_LIMIT);
  if (overflow === 0) return { runs, retainedLineCount };
  const capped = runs.map((run) => {
    const dropped = Math.min(overflow, run.lines.length);
    overflow -= dropped;
    return dropped === 0
      ? run
      : {
          ...run,
          lines: run.lines.slice(dropped),
          droppedLineCount: run.droppedLineCount + dropped,
        };
  });
  return { runs: capped, retainedLineCount: CONSOLE_LINE_LIMIT };
}

function finishRun(run: ConsoleRun, durationMs: number, result: RenderResult): ConsoleRun {
  const fallbackLines = run.lines.length === 0 && !run.rawLogFallbackSuppressed
    ? splitRaw(result.rawLog).map((raw, part) => ({
        sequence: part,
        part: 0,
        elapsedMs: durationMs,
        stream: "unknown" as const,
        raw,
      }))
    : run.lines;
  return {
    ...run,
    status: result.kind === "failure" ? result.reason : "success",
    durationMs,
    ...(result.kind === "failure" && typeof result.exitCode === "number"
      ? { exitCode: result.exitCode }
      : {}),
    ...(result.kind === "3d" ? { stats: result.stats } : {}),
    diagnostics: result.diagnostics,
    lines: fallbackLines,
  };
}

export function reduceConsoleState(state: ConsoleState, action: ConsoleAction): ConsoleState {
  if (action.kind === "clear") {
    const running = state.runs
      .filter(({ status }) => status === "running")
      .map((run) => ({
        ...run,
        lines: [],
        diagnostics: [],
        droppedLineCount: 0,
        rawLogFallbackSuppressed: true,
      }));
    return { runs: running, retainedLineCount: 0 };
  }
  if (action.kind === "start-run") {
    return capLines([
      ...state.runs,
      {
        jobId: action.jobId,
        entryFile: action.entryFile,
        quality: action.quality,
        startedAt: action.startedAt,
        status: "running",
        diagnostics: [],
        lines: [],
        droppedLineCount: 0,
      },
    ]);
  }
  const runIndex = state.runs.findIndex(({ jobId }) => jobId === action.jobId);
  if (runIndex < 0) return state;
  const runs = [...state.runs];
  const run = runs[runIndex];
  runs[runIndex] = action.kind === "append-output"
    ? { ...run, lines: [...run.lines, ...eventLines(action.event)] }
    : finishRun(run, action.durationMs, action.result);
  return capLines(runs);
}

function runOutcome(run: ConsoleRun): string {
  if (run.status === "running") return "running";
  if (run.status === "success") return "exit 0";
  if (run.status === "engine-error" && run.exitCode !== undefined) return `exit ${run.exitCode}`;
  return run.status.replace("-", " ");
}

export function formatConsoleHistory(state: ConsoleState): string {
  return state.runs.map((run) => {
    const duration = run.durationMs === undefined ? "pending" : `${run.durationMs} ms`;
    const header = `${run.entryFile} · ${run.quality} · ${duration} · ${runOutcome(run)}`;
    const dropped = run.droppedLineCount > 0
      ? `[${run.droppedLineCount} older lines dropped]\n`
      : "";
    const diagnostics = run.diagnostics.map((diagnostic) => {
      const location = diagnostic.file && diagnostic.line
        ? ` ${diagnostic.file}:${diagnostic.line}`
        : "";
      return `[${diagnostic.severity}]${location} ${diagnostic.message}\n`;
    }).join("");
    const output = run.lines.map((line) =>
      `[+${(line.elapsedMs / 1000).toFixed(3)}s ${line.stream}] ${line.raw}`
    ).join("");
    return `=== ${header} ===\n${dropped}${diagnostics}${output}`;
  }).join("\n");
}
