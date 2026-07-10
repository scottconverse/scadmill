import { describe, expect, it } from "vitest";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import {
  auditThemeContrast,
  contrastRatio,
  THEME_CONTRAST_PAIRS,
} from "../../../src/application/theme/theme-contrast";

const REQUIRED_FOREGROUNDS = [
  "chrome.text",
  "chrome.textMuted",
  "chrome.textDisabled",
  "chrome.border",
  "chrome.accentText",
  "chrome.focusRing",
  "chrome.statusBarText",
  "chrome.badgeInfo",
  "chrome.badgeWarning",
  "chrome.badgeError",
  "editor.text",
  "editor.lineNumber",
  "editor.cursor",
  "editor.matchingBracket",
  "editor.squiggleError",
  "editor.squiggleWarning",
  ...[
    "keyword",
    "builtin",
    "userModule",
    "number",
    "string",
    "boolean",
    "specialVariable",
    "comment",
    "operator",
    "modifierChar",
    "punctuation",
  ].map((token) => `editor.syntax.${token}`),
  ...[
    "mesh",
    "meshHighlight",
    "edges",
    "grid",
    "gridMajor",
    "axisX",
    "axisY",
    "axisZ",
    "measurement",
    "annotation",
    "clippingCap",
  ].map((token) => `viewer.${token}`),
  ...[
    "text",
    "error",
    "warning",
    "echo",
    "trace",
    "info",
    "runSeparator",
    "timestamp",
  ].map((token) => `console.${token}`),
  "diff.addedText",
  "diff.removedText",
  "diff.hunkHeader",
] as const;

const EDITOR_READABLE_FOREGROUNDS = [
  "editor.text",
  "editor.lineNumber",
  ...[
    "keyword",
    "builtin",
    "userModule",
    "number",
    "string",
    "boolean",
    "specialVariable",
    "comment",
    "operator",
    "modifierChar",
    "punctuation",
  ].map((token) => `editor.syntax.${token}`),
] as const;

describe("WCAG theme contrast", () => {
  it("uses the WCAG sRGB luminance oracle", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#357ab8", "#357ab8")).toBe(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("declares a conservative, non-empty pair matrix for every readable token family", () => {
    expect(THEME_CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(45);
    const covered = new Set(THEME_CONTRAST_PAIRS.map((pair) => pair.foreground));
    for (const path of REQUIRED_FOREGROUNDS) {
      expect(covered.has(path), path).toBe(true);
    }
    expect(THEME_CONTRAST_PAIRS.every((pair) => pair.minimum === 3 || pair.minimum === 4.5)).toBe(
      true,
    );

    const ids = new Set(THEME_CONTRAST_PAIRS.map((pair) => pair.id));
    for (const id of [
      "chrome-text-hover",
      "chrome-text-active",
      "chrome-text-selection",
      "chrome-focus-ring-surface",
      "editor-text-active-line",
      "editor-text-selection",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("checks readable editor colors on their normal and active-line backgrounds", () => {
    const pairs = new Set(
      THEME_CONTRAST_PAIRS.map((pair) => `${pair.foreground}|${pair.background}`),
    );

    for (const foreground of EDITOR_READABLE_FOREGROUNDS) {
      for (const background of ["editor.background", "editor.activeLine"]) {
        expect(pairs.has(`${foreground}|${background}`), `${foreground} on ${background}`).toBe(
          true,
        );
      }
    }

    expect(pairs.has("editor.text|editor.selection"), "selected text").toBe(true);
  });

  it("checks chrome content and control boundaries on every applicable surface", () => {
    const pairs = new Set(
      THEME_CONTRAST_PAIRS.map((pair) => `${pair.foreground}|${pair.background}`),
    );
    const requiredPairs = [
      ...["background", "surface", "surfaceRaised", "hover", "active", "selection"].map(
        (background) => `chrome.text|chrome.${background}`,
      ),
      ...["textMuted", "textDisabled", "border"].flatMap((foreground) =>
        ["background", "surface", "surfaceRaised"].map(
          (background) => `chrome.${foreground}|chrome.${background}`,
        ),
      ),
      ...["focusRing", "badgeInfo", "badgeWarning", "badgeError"].flatMap((foreground) =>
        ["background", "surface", "surfaceRaised"].map(
          (background) => `chrome.${foreground}|chrome.${background}`,
        ),
      ),
      "chrome.accent|chrome.background",
      "chrome.accent|chrome.surface",
    ];

    for (const pair of requiredPairs) {
      expect(pairs.has(pair), pair).toBe(true);
    }
  });

  it("reports a concrete failure when a foreground collapses onto its background", () => {
    const invalid: { chrome: { text: string; background: string } } = JSON.parse(
      JSON.stringify(SHIPPED_THEMES[0]),
    );
    invalid.chrome.text = invalid.chrome.background;

    expect(auditThemeContrast(invalid as (typeof SHIPPED_THEMES)[number])).toContainEqual({
      pair: expect.objectContaining({ id: "chrome-text-background", minimum: 4.5 }),
      ratio: 1,
    });
  });

  it.each(SHIPPED_THEMES)("passes every declared pair for $meta.name", (theme) => {
    const failures = auditThemeContrast(theme);
    expect(
      failures,
      failures
        .map(
          (failure) =>
            `${failure.pair.id}: ${failure.ratio.toFixed(2)} < ${failure.pair.minimum}`,
        )
        .join("\n"),
    ).toEqual([]);
  });
});
