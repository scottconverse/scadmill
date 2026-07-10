// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConsoleState } from "../../../src/application/diagnostics/console-state";
import { messages } from "../../../src/messages/en";
import { DiagnosticConsole } from "../../../src/ui/diagnostics/DiagnosticConsole";

const state: ConsoleState = {
  retainedLineCount: 2,
  runs: [
    {
      jobId: "run-preview",
      entryFile: "main.scad",
      quality: "preview",
      startedAt: "2026-07-10T13:00:00.000Z",
      status: "engine-error",
      durationMs: 15,
      exitCode: 1,
      diagnostics: [
        { severity: "error", message: "Parser error", file: "main.scad", line: 2 },
        { severity: "echo", message: "\"hi\", 42" },
      ],
      lines: [
        { sequence: 0, part: 0, elapsedMs: 3, stream: "stdout", raw: "ECHO: \"hi\", 42\n" },
      ],
      droppedLineCount: 4,
    },
    {
      jobId: "run-full",
      entryFile: "parts/body.scad",
      quality: "full",
      startedAt: "2026-07-10T13:01:00.000Z",
      status: "success",
      durationMs: 22,
      diagnostics: [],
      lines: [
        { sequence: 0, part: 0, elapsedMs: 7, stream: "stderr", raw: "Facets: 12\n" },
      ],
      droppedLineCount: 0,
    },
  ],
};

describe("DiagnosticConsole", () => {
  it("shows per-run separators, timestamped streams, diagnostics, and dropped-line notices", () => {
    const view = render(
      <DiagnosticConsole state={state} emptyMessage="No runs" onClear={vi.fn()} />,
    );
    const consoleView = within(view.container);

    expect(consoleView.getByText("main.scad · preview · 15 ms · exit 1")).toBeVisible();
    expect(consoleView.getByText("parts/body.scad · full · 22 ms · exit 0")).toBeVisible();
    expect(consoleView.getByText(messages.consoleLinesDropped(4))).toBeVisible();
    expect(consoleView.getByText("+0.003s")).toBeVisible();
    expect(consoleView.getByText("stdout")).toBeVisible();
    expect(consoleView.getByText("\"hi\", 42")).toHaveAttribute("data-severity", "echo");
  });

  it("filters structured diagnostics by severity and searches all visible records", () => {
    const view = render(
      <DiagnosticConsole state={state} emptyMessage="No runs" onClear={vi.fn()} />,
    );
    const consoleView = within(view.container);
    fireEvent.change(
      consoleView.getByRole("combobox", { name: messages.consoleSeverityFilter }),
      { target: { value: "echo" } },
    );

    expect(consoleView.getByText("\"hi\", 42")).toBeVisible();
    expect(consoleView.queryByText("Parser error")).not.toBeInTheDocument();
    expect(consoleView.queryByText("Facets: 12")).not.toBeInTheDocument();

    fireEvent.change(consoleView.getByRole("searchbox", { name: messages.consoleSearch }), {
      target: { value: "no match" },
    });
    expect(consoleView.getByText(messages.consoleNoMatches)).toBeVisible();
  });

  it("copies complete retained history independent of filters and clears through its command", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const onClear = vi.fn();
    const view = render(
      <DiagnosticConsole
        state={state}
        emptyMessage="No runs"
        clipboard={clipboard}
        onClear={onClear}
      />,
    );
    const consoleView = within(view.container);
    fireEvent.change(
      consoleView.getByRole("combobox", { name: messages.consoleSeverityFilter }),
      { target: { value: "error" } },
    );
    fireEvent.click(consoleView.getByRole("button", { name: messages.consoleCopyAll }));

    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledTimes(1));
    expect(clipboard.writeText.mock.calls[0][0]).toContain("Facets: 12");
    expect(consoleView.getByText(messages.consoleCopied)).toBeVisible();

    fireEvent.click(consoleView.getByRole("button", { name: messages.consoleClear }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a running job that has not emitted output from an empty filter result", () => {
    const running: ConsoleState = {
      retainedLineCount: 0,
      runs: [{
        jobId: "run-waiting",
        entryFile: "main.scad",
        quality: "preview",
        startedAt: "2026-07-10T13:02:00.000Z",
        status: "running",
        diagnostics: [],
        lines: [],
        droppedLineCount: 0,
      }],
    };
    const view = render(
      <DiagnosticConsole state={running} emptyMessage="No runs" onClear={vi.fn()} />,
    );

    expect(within(view.container).getByText(messages.consoleWaiting)).toBeVisible();
    expect(within(view.container).queryByText(messages.consoleNoMatches)).not.toBeInTheDocument();
  });
});
