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

const FUZZ_ALPHABET = [
  "\u0000",
  "\u0001",
  "\u0008",
  "\t",
  "\u001b",
  "\u001f",
  "\u007f",
  " ",
  "!",
  "~",
  "é",
  "中",
  "☃",
  "\u0301",
  "🙂",
  "𐍈",
] as const;

function seededFuzzLine(seed: number, length: number): string {
  let state = seed >>> 0;
  const characters: string[] = [];
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    characters.push(FUZZ_ALPHABET[(state >>> 0) % FUZZ_ALPHABET.length]);
  }
  return characters.join("");
}

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

  it("tolerates seeded arbitrary stderr with control and Unicode characters", () => {
    const seeds = [0, 0x1, 0x1020_3040, 0x7fff_ffff, 0xdead_beef];
    const lengths = [0, 1, 2, 7, 31, 128, 511, 2_048];
    const seenCharacters = new Set<string>();

    for (const seed of seeds) {
      for (const length of lengths) {
        const raw = seededFuzzLine(seed, length);
        const parsed = parseEngineLog(raw);
        for (const character of raw) seenCharacters.add(character);

        expect(parsed.lines).toEqual(raw.length === 0 ? [] : [{ raw }]);
        expect(parsed.diagnostics).toEqual([]);
      }
    }

    expect([...seenCharacters]).toEqual(
      expect.arrayContaining(["\u0000", "\u001b", "\u007f", "é", "中", "🙂"]),
    );
  });

  it("preserves diagnostic-looking near misses without fabricating diagnostics", () => {
    const nearMisses = [
      "ERROR",
      "ERROR : spaced separator",
      " ERROR: leading whitespace",
      "WARNING\u0000: embedded control",
      "ECHO\t: tab before separator",
      "TRACE : spaced separator",
      "WARN: shortened prefix",
      "ERROЯ: confusable suffix",
    ];

    for (const raw of nearMisses) {
      expect(parseEngineLog(raw)).toEqual({ diagnostics: [], lines: [{ raw }] });
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
