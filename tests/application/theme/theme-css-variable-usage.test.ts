import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { themeCssVariables } from "../../../src/application/theme/theme-runtime";

const APPENDIX_C_COLOR_VARIABLES = [
  "--chrome-background",
  "--chrome-surface",
  "--chrome-surface-raised",
  "--chrome-border",
  "--chrome-text",
  "--chrome-text-muted",
  "--chrome-text-disabled",
  "--chrome-accent",
  "--chrome-accent-text",
  "--chrome-focus-ring",
  "--chrome-hover",
  "--chrome-active",
  "--chrome-selection",
  "--chrome-status-bar-background",
  "--chrome-status-bar-text",
  "--chrome-badge-info",
  "--chrome-badge-warning",
  "--chrome-badge-error",
  "--editor-background",
  "--editor-text",
  "--editor-line-number",
  "--editor-active-line",
  "--editor-cursor",
  "--editor-selection",
  "--editor-matching-bracket",
  "--editor-squiggle-error",
  "--editor-squiggle-warning",
  "--editor-syntax-keyword",
  "--editor-syntax-builtin",
  "--editor-syntax-user-module",
  "--editor-syntax-number",
  "--editor-syntax-string",
  "--editor-syntax-boolean",
  "--editor-syntax-special-variable",
  "--editor-syntax-comment",
  "--editor-syntax-operator",
  "--editor-syntax-modifier-char",
  "--editor-syntax-punctuation",
  "--viewer-background",
  "--viewer-mesh",
  "--viewer-mesh-highlight",
  "--viewer-edges",
  "--viewer-grid",
  "--viewer-grid-major",
  "--viewer-axis-x",
  "--viewer-axis-y",
  "--viewer-axis-z",
  "--viewer-measurement",
  "--viewer-annotation",
  "--viewer-clipping-cap",
  "--console-background",
  "--console-text",
  "--console-error",
  "--console-warning",
  "--console-echo",
  "--console-trace",
  "--console-info",
  "--console-run-separator",
  "--console-timestamp",
  "--diff-added-background",
  "--diff-added-text",
  "--diff-removed-background",
  "--diff-removed-text",
  "--diff-hunk-header",
] as const;

const SOURCE_ROOT = join(process.cwd(), "src");
const SCANNED_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);
const CUSTOM_PROPERTY = /--[a-z][a-z0-9-]*/gu;
const SCRIPT_CUSTOM_PROPERTY_CONTEXTS = [
  /var\(\s*(--[a-z][a-z0-9-]*)/gu,
  /["'`](--[a-z][a-z0-9-]*)["'`]/gu,
  /(--[a-z][a-z0-9-]*)\s*:/gu,
];

interface CustomPropertyOccurrence {
  readonly file: string;
  readonly line: number;
  readonly variable: string;
}

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(path);
    return SCANNED_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r?\n/u).length;
}

function propertiesInFile(path: string): CustomPropertyOccurrence[] {
  const source = readFileSync(path, "utf8");
  const contexts = extname(path) === ".css" ? [CUSTOM_PROPERTY] : SCRIPT_CUSTOM_PROPERTY_CONTEXTS;
  const occurrences = contexts.flatMap((pattern) =>
    Array.from(source.matchAll(pattern), (match) => {
      const variable = match[1] ?? match[0];
      const offset = (match.index ?? 0) + match[0].indexOf(variable);
      return {
        file: relative(process.cwd(), path).replaceAll("\\", "/"),
        line: lineAt(source, offset),
        variable,
      };
    }),
  );

  return Array.from(
    new Map(
      occurrences.map((occurrence) => [
        `${occurrence.file}:${occurrence.line}:${occurrence.variable}`,
        occurrence,
      ]),
    ).values(),
  );
}

function darkTheme() {
  const theme = SHIPPED_THEMES.find((candidate) => candidate.meta.kind === "dark");
  if (!theme) throw new Error("The shipped dark theme is required for the CSS-variable contract test.");
  return theme;
}

describe("Appendix C CSS custom-property contract", () => {
  it("keeps the runtime mapping equal to the test-owned set of exactly 64 Appendix C variables", () => {
    expect(APPENDIX_C_COLOR_VARIABLES).toHaveLength(64);
    expect(Array.from(themeCssVariables(darkTheme()).keys()).toSorted()).toEqual(
      [...APPENDIX_C_COLOR_VARIABLES].toSorted(),
    );
  });

  it("uses only Appendix C color variables throughout production CSS and UI code", () => {
    const allowed = new Set<string>(APPENDIX_C_COLOR_VARIABLES);
    const unknown = productionSourceFiles(SOURCE_ROOT)
      .flatMap(propertiesInFile)
      .filter(({ variable }) => !allowed.has(variable))
      .toSorted((left, right) =>
        `${left.variable}:${left.file}:${left.line}`.localeCompare(
          `${right.variable}:${right.file}:${right.line}`,
        ),
      );

    expect(unknown).toEqual([]);
  });
});
