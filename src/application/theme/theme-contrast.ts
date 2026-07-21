import {
  CONSOLE_TOKEN_KEYS,
  EDITOR_SYNTAX_TOKEN_KEYS,
  type ThemeTokens,
  VIEWER_TOKEN_KEYS,
} from "./theme-schema";

export interface ThemeContrastPair {
  readonly id: string;
  readonly foreground: string;
  readonly background: string;
  readonly minimum: 3 | 4.5;
}

export interface ThemeContrastFailure {
  readonly pair: ThemeContrastPair;
  readonly ratio: number;
}

const CHROME_BASE_SURFACES = [
  "chrome.background",
  "chrome.surface",
  "chrome.surfaceRaised",
] as const;

const EDITOR_CONTENT_BACKGROUNDS = ["editor.background", "editor.activeLine"] as const;

const EDITOR_READABLE_FOREGROUNDS = [
  "editor.text",
  "editor.lineNumber",
  ...EDITOR_SYNTAX_TOKEN_KEYS.map((token) => `editor.syntax.${token}`),
] as const;

const EDITOR_NON_TEXT_FOREGROUNDS = [
  "editor.cursor",
  "editor.matchingBracket",
  "editor.squiggleError",
  "editor.squiggleWarning",
] as const;

function kebabPath(path: string): string {
  return path
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replaceAll(".", "-")
    .toLowerCase();
}

function pairId(foreground: string, background: string): string {
  const foregroundRoot = foreground.split(".", 1)[0];
  const backgroundParts = background.split(".");
  const backgroundSuffix =
    backgroundParts[0] === foregroundRoot ? backgroundParts.slice(1).join(".") : background;
  return `${kebabPath(foreground)}-${kebabPath(backgroundSuffix)}`;
}

function pairMatrix(
  foregrounds: readonly string[],
  backgrounds: readonly string[],
  minimum: 3 | 4.5,
): ThemeContrastPair[] {
  return foregrounds.flatMap((foreground) =>
    backgrounds.map((background) => ({
      id: pairId(foreground, background),
      foreground,
      background,
      minimum,
    })),
  );
}

export const THEME_CONTRAST_PAIRS: readonly ThemeContrastPair[] = Object.freeze([
  ...pairMatrix(
    ["chrome.text"],
    [
      ...CHROME_BASE_SURFACES,
      "chrome.hover",
      "chrome.active",
      "chrome.selection",
    ],
    4.5,
  ),
  ...pairMatrix(["chrome.textMuted", "chrome.textDisabled"], CHROME_BASE_SURFACES, 4.5),
  ...pairMatrix(["chrome.border"], CHROME_BASE_SURFACES, 3),
  ...pairMatrix(["chrome.accentText"], ["chrome.accent"], 4.5),
  ...pairMatrix(["chrome.accent"], ["chrome.background", "chrome.surface"], 3),
  ...pairMatrix(
    ["chrome.focusRing", "chrome.badgeInfo", "chrome.badgeWarning", "chrome.badgeError"],
    CHROME_BASE_SURFACES,
    3,
  ),
  ...pairMatrix(["chrome.statusBarText"], ["chrome.statusBarBackground"], 4.5),
  ...pairMatrix(EDITOR_READABLE_FOREGROUNDS, EDITOR_CONTENT_BACKGROUNDS, 4.5),
  ...pairMatrix(["editor.text"], ["editor.selection"], 4.5),
  ...pairMatrix(EDITOR_NON_TEXT_FOREGROUNDS, EDITOR_CONTENT_BACKGROUNDS, 3),
  ...pairMatrix(
    VIEWER_TOKEN_KEYS.filter((token) => token !== "background").map(
      (token) => `viewer.${token}`,
    ),
    ["viewer.background"],
    3,
  ),
  ...pairMatrix(
    CONSOLE_TOKEN_KEYS.filter((token) => token !== "background").map(
      (token) => `console.${token}`,
    ),
    ["console.background"],
    4.5,
  ),
  ...pairMatrix(["diff.addedText"], ["diff.addedBackground"], 4.5),
  ...pairMatrix(["diff.removedText"], ["diff.removedBackground"], 4.5),
  ...pairMatrix(["diff.hunkHeader"], ["editor.background"], 4.5),
]);

const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

function relativeLuminance(color: string): number {
  if (!HEX_COLOR.test(color)) {
    throw new TypeError(`Expected an opaque six-digit hexadecimal color, received ${color}.`);
  }

  const channels = [color.slice(1, 3), color.slice(3, 5), color.slice(5, 7)].map((channel) => {
    const srgb = Number.parseInt(channel, 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function colorAtPath(theme: ThemeTokens, path: string): string {
  let value: unknown = theme;

  for (const segment of path.split(".")) {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Object.hasOwn(value, segment)
    ) {
      throw new TypeError(`Theme color path does not exist: ${path}.`);
    }
    value = (value as Record<string, unknown>)[segment];
  }

  if (typeof value !== "string") {
    throw new TypeError(`Theme color path is not a string: ${path}.`);
  }

  return value;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function auditThemeContrast(theme: ThemeTokens): ThemeContrastFailure[] {
  const failures: ThemeContrastFailure[] = [];

  for (const pair of THEME_CONTRAST_PAIRS) {
    const ratio = contrastRatio(
      colorAtPath(theme, pair.foreground),
      colorAtPath(theme, pair.background),
    );
    if (ratio < pair.minimum) {
      failures.push({ pair, ratio });
    }
  }

  return failures;
}
