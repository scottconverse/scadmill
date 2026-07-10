import darkThemeJson from "../../theme/themes/dark.json";
import highContrastThemeJson from "../../theme/themes/high-contrast.json";
import lightThemeJson from "../../theme/themes/light.json";

import type { ThemeTokens } from "./theme-schema";
import { validateThemeTokens } from "./theme-schema";

const darkTheme: unknown = darkThemeJson;
const highContrastTheme: unknown = highContrastThemeJson;
const lightTheme: unknown = lightThemeJson;

function validatedTheme(value: unknown): ThemeTokens {
  if (!validateThemeTokens(value)) {
    throw new Error("A shipped theme does not match the Appendix C schema.");
  }

  return value;
}

export const SHIPPED_THEMES: readonly ThemeTokens[] = Object.freeze([
  validatedTheme(darkTheme),
  validatedTheme(lightTheme),
  validatedTheme(highContrastTheme),
]);
