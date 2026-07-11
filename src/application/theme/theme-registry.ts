import type { CustomThemePreference, ThemePreference } from "./theme-runtime";
import { resolveTheme } from "./theme-runtime";
import type { ThemeTokens } from "./theme-schema";

export interface RegisteredTheme {
  readonly preference: CustomThemePreference;
  readonly theme: ThemeTokens;
}

export interface ThemeRegistry {
  register(theme: ThemeTokens): CustomThemePreference;
  list(): readonly RegisteredTheme[];
  resolve(preference: ThemePreference, prefersDark: boolean): ThemeTokens;
}

export function customThemePreference(name: string): CustomThemePreference {
  return `custom:${encodeURIComponent(name)}`;
}

function isCustomThemePreference(
  preference: ThemePreference,
): preference is CustomThemePreference {
  return preference.startsWith("custom:");
}

export function createThemeRegistry(initialThemes: readonly ThemeTokens[] = []): ThemeRegistry {
  const customThemes = new Map<CustomThemePreference, ThemeTokens>();
  for (const theme of initialThemes) {
    customThemes.set(customThemePreference(theme.meta.name), theme);
  }

  return {
    register(theme) {
      const preference = customThemePreference(theme.meta.name);
      customThemes.set(preference, theme);
      return preference;
    },
    list: () =>
      Array.from(customThemes, ([preference, theme]) => ({ preference, theme })),
    resolve(preference, prefersDark) {
      if (isCustomThemePreference(preference)) {
        const customTheme = customThemes.get(preference);
        if (!customTheme) {
          throw new Error(`Custom theme ${preference} is not registered.`);
        }
        return customTheme;
      }
      return resolveTheme(preference, prefersDark);
    },
  };
}
