import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseEngineLog } from "../../../src/application/diagnostics/parse-engine-log";

const knownFixture = readFileSync(
  new URL("../../fixtures/diagnostics/openscad-2021.01-error-warning.txt", import.meta.url),
  "utf8",
);
const echoFixture = readFileSync(
  new URL("../../fixtures/diagnostics/openscad-2021.01-echo.txt", import.meta.url),
  "utf8",
);

describe("parseEngineLog", () => {
  it("maps the pinned engine's error and warning locations without rewriting its messages", () => {
    const parsed = parseEngineLog(knownFixture);

    expect(parsed.diagnostics).toEqual([
      {
        severity: "warning",
        message: "Ignoring unknown variable 'missing_one' in file warnings.scad, line 1",
        file: "warnings.scad",
        line: 1,
      },
      {
        severity: "warning",
        message: "Ignoring unknown variable 'missing_two' in file warnings.scad, line 2",
        file: "warnings.scad",
        line: 2,
      },
      {
        severity: "error",
        message: "Parser error: syntax error in file error.scad, line 3",
        file: "error.scad",
        line: 3,
      },
    ]);
  });

  it("preserves unknown and garbled lines as raw console content", () => {
    const rawLog = "unclassified engine text\r\n\u0001garbled\n\nlast line";

    expect(parseEngineLog(rawLog)).toEqual({
      diagnostics: [],
      lines: [
        { raw: "unclassified engine text" },
        { raw: "\u0001garbled" },
        { raw: "" },
        { raw: "last line" },
      ],
    });
  });

  it("tolerates deterministic fuzz lines while retaining every raw value", () => {
    for (let index = 0; index < 128; index += 1) {
      const raw = `${String.fromCharCode(33 + (index % 90))}${index.toString(36)} ???`;
      const parsed = parseEngineLog(raw);
      expect(parsed.lines).toEqual([{ raw }]);
      expect(parsed.diagnostics).toEqual([]);
    }
  });

  it("classifies the pinned engine's echo payload without treating it as a warning", () => {
    expect(parseEngineLog(echoFixture).diagnostics).toEqual([
      { severity: "echo", message: "\"hi\", 42" },
    ]);
  });

  it("classifies trace output and its optional source location", () => {
    const raw = "TRACE: called by 'wheel' in file parts/wheel.scad, line 7";

    expect(parseEngineLog(raw).diagnostics).toEqual([
      {
        severity: "trace",
        message: "called by 'wheel' in file parts/wheel.scad, line 7",
        file: "parts/wheel.scad",
        line: 7,
      },
    ]);
  });

  it("resolves engine workspace filenames to logical project paths", () => {
    const raw = "ERROR: Parser error in file main.scad, line 9";

    expect(parseEngineLog(raw, {
      resolveFile: (reported) => reported === "main.scad" ? "parts/body.scad" : reported,
    }).diagnostics).toEqual([
      {
        severity: "error",
        message: "Parser error in file main.scad, line 9",
        file: "parts/body.scad",
        line: 9,
      },
    ]);
  });
});
