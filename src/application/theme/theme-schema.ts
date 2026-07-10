export const THEME_KINDS = ["light", "dark", "high-contrast"] as const;

export type ThemeKind = (typeof THEME_KINDS)[number];

type ColorTokens<Key extends string> = Readonly<Record<Key, string>>;

const TOP_LEVEL_KEYS = ["meta", "chrome", "editor", "viewer", "console", "diff"] as const;

const META_KEYS = ["name", "kind", "version"] as const;

export const CHROME_TOKEN_KEYS = [
  "background",
  "surface",
  "surfaceRaised",
  "border",
  "text",
  "textMuted",
  "textDisabled",
  "accent",
  "accentText",
  "focusRing",
  "hover",
  "active",
  "selection",
  "statusBarBackground",
  "statusBarText",
  "badgeInfo",
  "badgeWarning",
  "badgeError",
] as const;

export const EDITOR_TOKEN_KEYS = [
  "background",
  "text",
  "lineNumber",
  "activeLine",
  "cursor",
  "selection",
  "matchingBracket",
  "squiggleError",
  "squiggleWarning",
] as const;

export const EDITOR_SYNTAX_TOKEN_KEYS = [
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
] as const;

export const VIEWER_TOKEN_KEYS = [
  "background",
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
] as const;

export const CONSOLE_TOKEN_KEYS = [
  "background",
  "text",
  "error",
  "warning",
  "echo",
  "trace",
  "info",
  "runSeparator",
  "timestamp",
] as const;

export const DIFF_TOKEN_KEYS = [
  "addedBackground",
  "addedText",
  "removedBackground",
  "removedText",
  "hunkHeader",
] as const;

type ChromeToken = (typeof CHROME_TOKEN_KEYS)[number];
type EditorToken = (typeof EDITOR_TOKEN_KEYS)[number];
type EditorSyntaxToken = (typeof EDITOR_SYNTAX_TOKEN_KEYS)[number];
type ViewerToken = (typeof VIEWER_TOKEN_KEYS)[number];
type ConsoleToken = (typeof CONSOLE_TOKEN_KEYS)[number];
type DiffToken = (typeof DIFF_TOKEN_KEYS)[number];

export interface ThemeTokens {
  readonly meta: {
    readonly name: string;
    readonly kind: ThemeKind;
    readonly version: 1;
  };
  readonly chrome: ColorTokens<ChromeToken>;
  readonly editor: ColorTokens<EditorToken> & {
    readonly syntax: ColorTokens<EditorSyntaxToken>;
  };
  readonly viewer: ColorTokens<ViewerToken>;
  readonly console: ColorTokens<ConsoleToken>;
  readonly diff: ColorTokens<DiffToken>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function hasExactStringTokens(value: unknown, expectedKeys: readonly string[]): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, expectedKeys) &&
    expectedKeys.every((key) => typeof value[key] === "string")
  );
}

function isMeta(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, META_KEYS) &&
    typeof value.name === "string" &&
    THEME_KINDS.some((kind) => value.kind === kind) &&
    value.version === 1
  );
}

function isEditor(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, [...EDITOR_TOKEN_KEYS, "syntax"])) {
    return false;
  }

  return (
    EDITOR_TOKEN_KEYS.every((key) => typeof value[key] === "string") &&
    hasExactStringTokens(value.syntax, EDITOR_SYNTAX_TOKEN_KEYS)
  );
}

export function validateThemeTokens(value: unknown): value is ThemeTokens {
  if (!isRecord(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) {
    return false;
  }

  return (
    isMeta(value.meta) &&
    hasExactStringTokens(value.chrome, CHROME_TOKEN_KEYS) &&
    isEditor(value.editor) &&
    hasExactStringTokens(value.viewer, VIEWER_TOKEN_KEYS) &&
    hasExactStringTokens(value.console, CONSOLE_TOKEN_KEYS) &&
    hasExactStringTokens(value.diff, DIFF_TOKEN_KEYS)
  );
}
