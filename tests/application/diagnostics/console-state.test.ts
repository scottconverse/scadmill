import { describe, expect, it } from "vitest";

import {
  type ConsoleState,
  createConsoleState,
  formatConsoleHistory,
  reduceConsoleState,
} from "../../../src/application/diagnostics/console-state";
import type { RenderFailure } from "../../../src/application/engine/contracts";

describe("console state", () => {
  it("formats exact localized running history with pending time and singular dropped output", () => {
    const state: ConsoleState = {
      retainedLineCount: 1,
      runs: [{
        jobId: "running",
        entryFile: "main.scad",
        quality: "preview",
        startedAt: "2026-07-10T13:00:00.000Z",
        status: "running",
        diagnostics: [{
          severity: "warning",
          message: "preview warning",
          file: "lib.scad",
          line: 7,
        }],
        lines: [{
          sequence: 0,
          part: 0,
          elapsedMs: 4,
          stream: "stdout",
          raw: "compiling\n",
        }],
        droppedLineCount: 1,
      }],
    };

    expect(formatConsoleHistory(state)).toBe(
      "=== main.scad · preview · pending · running ===\n"
      + "[1 older line dropped]\n"
      + "[Warning] lib.scad:7 preview warning\n"
      + "[+0.004s stdout] compiling\n",
    );
  });

  it("formats exact localized completed outcomes and plural dropped output", () => {
    const state: ConsoleState = {
      retainedLineCount: 2,
      runs: [
        {
          jobId: "success",
          entryFile: "done.scad",
          quality: "full",
          startedAt: "2026-07-10T13:00:00.000Z",
          status: "success",
          durationMs: 25,
          diagnostics: [{ severity: "error", message: "failed", file: "done.scad", line: 9 }],
          lines: [{
            sequence: 0,
            part: 0,
            elapsedMs: 1_004,
            stream: "stderr",
            raw: "failure\n",
          }],
          droppedLineCount: 2,
        },
        {
          jobId: "engine-error",
          entryFile: "error.scad",
          quality: "preview",
          startedAt: "2026-07-10T13:00:01.000Z",
          status: "engine-error",
          durationMs: 30,
          exitCode: 7,
          diagnostics: [],
          lines: [{
            sequence: 0,
            part: 0,
            elapsedMs: 1_500,
            stream: "unknown",
            raw: "other\n",
          }],
          droppedLineCount: 0,
        },
        {
          jobId: "timeout",
          entryFile: "timeout.scad",
          quality: "full",
          startedAt: "2026-07-10T13:00:02.000Z",
          status: "timeout",
          durationMs: 30_000,
          diagnostics: [],
          lines: [],
          droppedLineCount: 0,
        },
      ],
    };

    expect(formatConsoleHistory(state)).toBe(
      "=== done.scad · full · 25 ms · exit 0 ===\n"
      + "[2 older lines dropped]\n"
      + "[Error] done.scad:9 failed\n"
      + "[+1.004s stderr] failure\n"
      + "\n=== error.scad · preview · 30 ms · exit 7 ===\n"
      + "[+1.500s unknown] other\n"
      + "\n=== timeout.scad · full · 30000 ms · timeout ===\n",
    );
  });

  it("retains ordered streamed output and finishes a run with metadata", () => {
    let state = createConsoleState();
    state = reduceConsoleState(state, {
      kind: "start-run",
      jobId: "job-1",
      entryFile: "main.scad",
      quality: "preview",
      startedAt: "2026-07-10T13:00:00.000Z",
    });
    state = reduceConsoleState(state, {
      kind: "append-output",
      jobId: "job-1",
      event: { sequence: 0, elapsedMs: 4, stream: "stdout", raw: "first\n" },
    });
    state = reduceConsoleState(state, {
      kind: "append-output",
      jobId: "job-1",
      event: { sequence: 1, elapsedMs: 7, stream: "stderr", raw: "WARNING: second\n" },
    });
    state = reduceConsoleState(state, {
      kind: "finish-run",
      jobId: "job-1",
      durationMs: 12,
      result: {
        kind: "failure",
        reason: "engine-error",
        exitCode: 1,
        diagnostics: [{ severity: "warning", message: "second" }],
        rawLog: "first\nWARNING: second\n",
      },
    });

    expect(state.retainedLineCount).toBe(2);
    expect(state.runs[0]).toMatchObject({
      jobId: "job-1",
      entryFile: "main.scad",
      quality: "preview",
      status: "engine-error",
      durationMs: 12,
      exitCode: 1,
      droppedLineCount: 0,
      diagnostics: [{ severity: "warning", message: "second" }],
      lines: [
        { sequence: 0, elapsedMs: 4, stream: "stdout", raw: "first\n" },
        { sequence: 1, elapsedMs: 7, stream: "stderr", raw: "WARNING: second\n" },
      ],
    });
    expect(formatConsoleHistory(state)).toContain("main.scad · preview · 12 ms · exit 1");
  });

  it("caps scrollback globally at 10000 lines and records the dropped count", () => {
    let state = reduceConsoleState(createConsoleState(), {
      kind: "start-run",
      jobId: "large",
      entryFile: "large.scad",
      quality: "full",
      startedAt: "2026-07-10T13:00:00.000Z",
    });
    const raw = Array.from({ length: 10_001 }, (_, index) => `line-${index}\n`).join("");
    state = reduceConsoleState(state, {
      kind: "append-output",
      jobId: "large",
      event: { sequence: 0, elapsedMs: 5, stream: "stderr", raw },
    });

    expect(state.retainedLineCount).toBe(10_000);
    expect(state.runs[0].droppedLineCount).toBe(1);
    expect(state.runs[0].lines[0].raw).toBe("line-1\n");
    expect(state.runs[0].lines.at(-1)?.raw).toBe("line-10000\n");
  });

  it("clears completed runs but keeps an in-flight shell receptive to later output", () => {
    let state = reduceConsoleState(createConsoleState(), {
      kind: "start-run",
      jobId: "running",
      entryFile: "main.scad",
      quality: "preview",
      startedAt: "2026-07-10T13:00:00.000Z",
    });
    state = reduceConsoleState(state, {
      kind: "append-output",
      jobId: "running",
      event: { sequence: 0, elapsedMs: 1, stream: "stdout", raw: "before clear\n" },
    });
    state = reduceConsoleState(state, { kind: "clear" });
    state = reduceConsoleState(state, {
      kind: "append-output",
      jobId: "running",
      event: { sequence: 1, elapsedMs: 2, stream: "stdout", raw: "after clear\n" },
    });

    expect(state.retainedLineCount).toBe(1);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ status: "running", droppedLineCount: 0 });
    expect(state.runs[0].lines[0].raw).toBe("after clear\n");
  });

  it("does not resurrect cleared output when a run finishes without a later event", () => {
    let state = reduceConsoleState(createConsoleState(), {
      kind: "start-run",
      jobId: "cleared",
      entryFile: "main.scad",
      quality: "preview",
      startedAt: "2026-07-10T13:00:00.000Z",
    });
    state = reduceConsoleState(state, {
      kind: "append-output",
      jobId: "cleared",
      event: { sequence: 0, elapsedMs: 1, stream: "stdout", raw: "before clear\n" },
    });
    state = reduceConsoleState(state, { kind: "clear" });
    state = reduceConsoleState(state, {
      kind: "finish-run",
      jobId: "cleared",
      durationMs: 20,
      result: {
        kind: "failure",
        reason: "cancelled",
        diagnostics: [],
        rawLog: "before clear\n",
      },
    });

    expect(state.runs[0]).toMatchObject({ status: "cancelled", lines: [] });
    expect(state.retainedLineCount).toBe(0);
  });

  it("uses a completed raw log only when an engine emitted no stream events", () => {
    const failure: RenderFailure = {
      kind: "failure",
      reason: "timeout",
      diagnostics: [],
      rawLog: "fallback one\nfallback two",
    };
    let state = reduceConsoleState(createConsoleState(), {
      kind: "start-run",
      jobId: "fallback",
      entryFile: "main.scad",
      quality: "preview",
      startedAt: "2026-07-10T13:00:00.000Z",
    });
    state = reduceConsoleState(state, {
      kind: "finish-run",
      jobId: "fallback",
      durationMs: 30_000,
      result: failure,
    });

    expect(state.runs[0]).toMatchObject({ status: "timeout", durationMs: 30_000 });
    expect(state.runs[0].lines.map(({ raw }) => raw)).toEqual(["fallback one\n", "fallback two"]);
  });
});
