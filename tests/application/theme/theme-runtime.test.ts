// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import {
  applyThemeToRoot,
  resolveTheme,
  themeCssVariables,
} from "../../../src/application/theme/theme-runtime";

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

function theme(kind: "light" | "dark" | "high-contrast") {
  const match = SHIPPED_THEMES.find((candidate) => candidate.meta.kind === kind);
  if (!match) {
    throw new Error(`Missing test theme: ${kind}.`);
  }
  return match;
}

describe("theme runtime", () => {
  it("resolves system preference to the current OS light or dark mode", () => {
    expect(resolveTheme("system", false).meta.kind).toBe("light");
    expect(resolveTheme("system", true).meta.kind).toBe("dark");
  });

  it.each(["light", "dark", "high-contrast"] as const)(
    "keeps the explicit %s override independent of OS preference",
    (preference) => {
      expect(resolveTheme(preference, false).meta.kind).toBe(preference);
      expect(resolveTheme(preference, true).meta.kind).toBe(preference);
    },
  );

  it("maps all 64 Appendix C color leaves to deterministic CSS custom properties", () => {
    const variables = themeCssVariables(theme("dark"));

    expect(variables).toHaveLength(64);
    expect([...variables.keys()]).toEqual(APPENDIX_C_COLOR_VARIABLES);
    expect(Object.fromEntries(variables)).toMatchObject({
      "--chrome-background": theme("dark").chrome.background,
      "--editor-syntax-special-variable": theme("dark").editor.syntax.specialVariable,
      "--viewer-clipping-cap": theme("dark").viewer.clippingCap,
      "--console-run-separator": theme("dark").console.runSeparator,
      "--diff-added-background": theme("dark").diff.addedBackground,
    });
  });

  it("applies and replaces a complete theme on one root without reloading it", () => {
    const root = document.createElement("main");

    applyThemeToRoot(theme("dark"), root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.style.getPropertyValue("--chrome-background")).toBe(
      theme("dark").chrome.background,
    );

    applyThemeToRoot(theme("light"), root);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
    expect(root.style.getPropertyValue("--chrome-background")).toBe(
      theme("light").chrome.background,
    );

    applyThemeToRoot(theme("high-contrast"), root);
    expect(root.dataset.theme).toBe("high-contrast");
    expect(root.style.colorScheme).toBe("dark");
  });
});
