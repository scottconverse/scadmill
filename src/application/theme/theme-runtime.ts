import { SHIPPED_THEMES } from "./shipped-themes";
import {
  CHROME_TOKEN_KEYS,
  CONSOLE_TOKEN_KEYS,
  DIFF_TOKEN_KEYS,
  EDITOR_SYNTAX_TOKEN_KEYS,
  EDITOR_TOKEN_KEYS,
  type ThemeKind,
  type ThemeTokens,
  VIEWER_TOKEN_KEYS,
} from "./theme-schema";

export type CustomThemePreference = `custom:${string}`;
export type ThemePreference = "system" | ThemeKind;

export interface ThemeDarkModeQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { matches: boolean }) => void): void;
}

export interface ThemeHost {
  readonly root: HTMLElement;
  readonly darkMode: ThemeDarkModeQuery;
}

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function createBrowserThemeHost(): ThemeHost {
  const darkMode = globalThis.matchMedia?.(SYSTEM_DARK_QUERY) ?? {
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  return { root: document.documentElement, darkMode };
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ThemeTokens {
  const kind = preference === "system" ? (prefersDark ? "dark" : "light") : preference;
  const theme = SHIPPED_THEMES.find((candidate) => candidate.meta.kind === kind);
  if (!theme) {
    throw new Error(`ScadMill does not have a shipped ${kind} theme.`);
  }
  return theme;
}

function kebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
}

export function themeCssVariables(theme: ThemeTokens): ReadonlyMap<string, string> {
  const variables = new Map<string, string>();
  const add = (group: string, token: string, value: string) => {
    variables.set(`--${group}-${kebab(token)}`, value);
  };

  for (const token of CHROME_TOKEN_KEYS) add("chrome", token, theme.chrome[token]);
  for (const token of EDITOR_TOKEN_KEYS) add("editor", token, theme.editor[token]);
  for (const token of EDITOR_SYNTAX_TOKEN_KEYS) {
    add("editor-syntax", token, theme.editor.syntax[token]);
  }
  for (const token of VIEWER_TOKEN_KEYS) add("viewer", token, theme.viewer[token]);
  for (const token of CONSOLE_TOKEN_KEYS) add("console", token, theme.console[token]);
  for (const token of DIFF_TOKEN_KEYS) add("diff", token, theme.diff[token]);

  return variables;
}

export function applyThemeToRoot(theme: ThemeTokens, root: HTMLElement): void {
  for (const [property, value] of themeCssVariables(theme)) {
    root.style.setProperty(property, value);
  }
  root.dataset.theme = theme.meta.kind;
  root.style.colorScheme = theme.meta.kind === "light" ? "light" : "dark";
}
