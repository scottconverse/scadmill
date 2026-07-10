import {
  CHROME_TOKEN_KEYS,
  CONSOLE_TOKEN_KEYS,
  DIFF_TOKEN_KEYS,
  EDITOR_SYNTAX_TOKEN_KEYS,
  EDITOR_TOKEN_KEYS,
  type ThemeTokens,
  VIEWER_TOKEN_KEYS,
  validateThemeTokens,
} from "./theme-schema";

export type ThemeColorValidator = (value: string, path: string) => boolean;

export interface ThemeLoadIssue {
  readonly code: "invalid-json" | "invalid-schema" | "invalid-color";
  readonly path: string;
  readonly message: string;
}

export type ThemeLoadResult =
  | { readonly ok: true; readonly theme: ThemeTokens }
  | { readonly ok: false; readonly issues: readonly ThemeLoadIssue[] };

export function parseThemeJson(
  source: string,
  validateColor: ThemeColorValidator,
): ThemeLoadResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    return {
      ok: false,
      issues: [{ code: "invalid-json", path: "$", message: "Theme JSON could not be parsed." }],
    };
  }

  if (!validateThemeTokens(parsed)) {
    return {
      ok: false,
      issues: [
        {
          code: "invalid-schema",
          path: "$",
          message: "Theme does not match the exact Appendix C schema.",
        },
      ],
    };
  }

  const colorEntries: readonly (readonly [path: string, value: string])[] = [
    ...CHROME_TOKEN_KEYS.map((key) => [`chrome.${key}`, parsed.chrome[key]] as const),
    ...EDITOR_TOKEN_KEYS.map((key) => [`editor.${key}`, parsed.editor[key]] as const),
    ...EDITOR_SYNTAX_TOKEN_KEYS.map(
      (key) => [`editor.syntax.${key}`, parsed.editor.syntax[key]] as const,
    ),
    ...VIEWER_TOKEN_KEYS.map((key) => [`viewer.${key}`, parsed.viewer[key]] as const),
    ...CONSOLE_TOKEN_KEYS.map((key) => [`console.${key}`, parsed.console[key]] as const),
    ...DIFF_TOKEN_KEYS.map((key) => [`diff.${key}`, parsed.diff[key]] as const),
  ];
  const issues: ThemeLoadIssue[] = [];

  for (const [path, value] of colorEntries) {
    if (!validateColor(value, path)) {
      issues.push({ code: "invalid-color", path, message: `Theme token ${path} is not a CSS color.` });
    }
  }

  return issues.length === 0 ? { ok: true, theme: parsed } : { ok: false, issues };
}
