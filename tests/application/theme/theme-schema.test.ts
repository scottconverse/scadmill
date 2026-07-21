import { describe, expect, it } from "vitest";

import { validateThemeTokens } from "../../../src/application/theme/theme-schema";

type JsonObject = Record<string, unknown>;

const COMPLETE_THEME = {
  meta: { name: "Test dark", kind: "dark", version: 1 },
  chrome: {
    background: "#101010",
    surface: "#111111",
    surfaceRaised: "#121212",
    border: "#131313",
    text: "#f0f0f0",
    textMuted: "#d0d0d0",
    textDisabled: "#a0a0a0",
    accent: "#146cc0",
    accentText: "#ffffff",
    focusRing: "#4ba3ff",
    hover: "#202020",
    active: "#252525",
    selection: "#294d70",
    statusBarBackground: "#080808",
    statusBarText: "#f5f5f5",
    badgeInfo: "#2276c7",
    badgeWarning: "#d99a00",
    badgeError: "#d7303f",
  },
  editor: {
    background: "#0f0f0f",
    text: "#eeeeee",
    lineNumber: "#999999",
    activeLine: "#181818",
    cursor: "#ffffff",
    selection: "#294d70",
    matchingBracket: "#65b5ff",
    squiggleError: "#ff6670",
    squiggleWarning: "#ffc247",
    syntax: {
      keyword: "#72b7ff",
      builtin: "#71d6b5",
      userModule: "#d2a8ff",
      number: "#ffc27a",
      string: "#a9db7a",
      boolean: "#ff9ab1",
      specialVariable: "#8bd5ff",
      comment: "#83909e",
      operator: "#f0f0f0",
      modifierChar: "#ff8f70",
      punctuation: "#cccccc",
    },
  },
  viewer: {
    background: "#0b1018",
    mesh: "#e7a93c",
    meshHighlight: "#ffd982",
    edges: "#1a1a1a",
    grid: "#3b4652",
    gridMajor: "#697887",
    axisX: "#f05d5e",
    axisY: "#54c57a",
    axisZ: "#5f8ff7",
    measurement: "#f7d35f",
    annotation: "#8ed8ff",
    clippingCap: "#da78f5",
  },
  console: {
    background: "#090909",
    text: "#e6e6e6",
    error: "#ff6670",
    warning: "#ffc247",
    echo: "#77d6a5",
    trace: "#a8a8a8",
    info: "#74b9ff",
    runSeparator: "#505050",
    timestamp: "#8f9aa7",
  },
  diff: {
    addedBackground: "#12351e",
    addedText: "#baf5c8",
    removedBackground: "#3b171b",
    removedText: "#ffc3ca",
    hunkHeader: "#1c3652",
  },
} as const;

const REQUIRED_PATHS = [
  "meta",
  "meta.name",
  "meta.kind",
  "meta.version",
  "chrome",
  "chrome.background",
  "chrome.surface",
  "chrome.surfaceRaised",
  "chrome.border",
  "chrome.text",
  "chrome.textMuted",
  "chrome.textDisabled",
  "chrome.accent",
  "chrome.accentText",
  "chrome.focusRing",
  "chrome.hover",
  "chrome.active",
  "chrome.selection",
  "chrome.statusBarBackground",
  "chrome.statusBarText",
  "chrome.badgeInfo",
  "chrome.badgeWarning",
  "chrome.badgeError",
  "editor",
  "editor.background",
  "editor.text",
  "editor.lineNumber",
  "editor.activeLine",
  "editor.cursor",
  "editor.selection",
  "editor.matchingBracket",
  "editor.squiggleError",
  "editor.squiggleWarning",
  "editor.syntax",
  "editor.syntax.keyword",
  "editor.syntax.builtin",
  "editor.syntax.userModule",
  "editor.syntax.number",
  "editor.syntax.string",
  "editor.syntax.boolean",
  "editor.syntax.specialVariable",
  "editor.syntax.comment",
  "editor.syntax.operator",
  "editor.syntax.modifierChar",
  "editor.syntax.punctuation",
  "viewer",
  "viewer.background",
  "viewer.mesh",
  "viewer.meshHighlight",
  "viewer.edges",
  "viewer.grid",
  "viewer.gridMajor",
  "viewer.axisX",
  "viewer.axisY",
  "viewer.axisZ",
  "viewer.measurement",
  "viewer.annotation",
  "viewer.clippingCap",
  "console",
  "console.background",
  "console.text",
  "console.error",
  "console.warning",
  "console.echo",
  "console.trace",
  "console.info",
  "console.runSeparator",
  "console.timestamp",
  "diff",
  "diff.addedBackground",
  "diff.addedText",
  "diff.removedBackground",
  "diff.removedText",
  "diff.hunkHeader",
] as const;

const OBJECT_PATHS = ["", "meta", "chrome", "editor", "editor.syntax", "viewer", "console", "diff"] as const;

function setAtPath(source: unknown, path: string, value: unknown): unknown {
  const copy = structuredClone(source) as JsonObject;
  const segments = path.split(".");
  const leaf = segments.pop();
  let cursor = copy;

  for (const segment of segments) {
    cursor = cursor[segment] as JsonObject;
  }

  if (leaf === undefined) {
    return value;
  }

  cursor[leaf] = value;
  return copy;
}

function deleteAtPath(source: unknown, path: string): unknown {
  const copy = structuredClone(source) as JsonObject;
  const segments = path.split(".");
  const leaf = segments.pop();
  let cursor = copy;

  for (const segment of segments) {
    cursor = cursor[segment] as JsonObject;
  }

  if (leaf !== undefined) {
    delete cursor[leaf];
  }

  return copy;
}

describe("validateThemeTokens", () => {
  it("accepts a complete Appendix C theme", () => {
    expect(validateThemeTokens(COMPLETE_THEME)).toBe(true);
  });

  it.each(["light", "dark", "high-contrast"] as const)("accepts the exact meta.kind value %s", (kind) => {
    expect(validateThemeTokens(setAtPath(COMPLETE_THEME, "meta.kind", kind))).toBe(true);
  });

  it.each(REQUIRED_PATHS)("rejects a theme missing required key %s", (path) => {
    expect(validateThemeTokens(deleteAtPath(COMPLETE_THEME, path))).toBe(false);
  });

  it.each(OBJECT_PATHS)("rejects an unknown key in %s", (objectPath) => {
    const unknownPath = objectPath === "" ? "unknown" : `${objectPath}.unknown`;
    expect(validateThemeTokens(setAtPath(COMPLETE_THEME, unknownPath, "#ffffff"))).toBe(false);
  });

  it.each([
    ["meta.name", 42],
    ["meta.kind", "contrast"],
    ["meta.kind", "LIGHT"],
    ["meta.version", 2],
    ["meta.version", "1"],
    ["chrome.background", 42],
    ["editor.syntax.keyword", null],
    ["viewer", []],
    ["console", "#000000"],
  ])("rejects the wrong value type or meta value at %s", (path, value) => {
    expect(validateThemeTokens(setAtPath(COMPLETE_THEME, path as string, value))).toBe(false);
  });

  it.each([null, undefined, [], "theme", 1, true])("rejects non-object input %#", (value) => {
    expect(validateThemeTokens(value)).toBe(false);
  });
});
