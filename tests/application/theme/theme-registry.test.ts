import { describe, expect, it } from "vitest";

import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import {
  createThemeRegistry,
  customThemePreference,
} from "../../../src/application/theme/theme-registry";
import type { ThemeTokens } from "../../../src/application/theme/theme-schema";

function customTheme(name: string, background: string): ThemeTokens {
  return {
    ...SHIPPED_THEMES[0],
    meta: { name, kind: "dark", version: 1 },
    chrome: { ...SHIPPED_THEMES[0].chrome, background },
  };
}

describe("theme registry", () => {
  it("registers a custom theme under a stable encoded preference and resolves it independently of OS mode", () => {
    const registry = createThemeRegistry();
    const theme = customTheme("Nord / personal", "#101820");

    const preference = registry.register(theme);

    expect(preference).toBe("custom:Nord%20%2F%20personal");
    expect(customThemePreference(theme.meta.name)).toBe(preference);
    expect(registry.list()).toEqual([{ preference, theme }]);
    expect(registry.resolve(preference, false)).toBe(theme);
    expect(registry.resolve(preference, true)).toBe(theme);
  });

  it("re-imports the same named theme as a replacement without changing its preference", () => {
    const registry = createThemeRegistry();
    const first = customTheme("Workshop", "#101820");
    const replacement = customTheme("Workshop", "#202830");

    const firstPreference = registry.register(first);
    const replacementPreference = registry.register(replacement);

    expect(replacementPreference).toBe(firstPreference);
    expect(registry.list()).toEqual([{ preference: firstPreference, theme: replacement }]);
    expect(registry.resolve(firstPreference, false)).toBe(replacement);
  });

  it("keeps system and shipped overrides on the immutable shipped themes", () => {
    const registry = createThemeRegistry();
    registry.register(customTheme("Custom dark", "#101820"));

    expect(registry.resolve("system", false).meta.kind).toBe("light");
    expect(registry.resolve("system", true).meta.kind).toBe("dark");
    expect(registry.resolve("high-contrast", false).meta.kind).toBe("high-contrast");
  });

  it("rejects an unregistered custom preference instead of silently changing themes", () => {
    const registry = createThemeRegistry();

    expect(() => registry.resolve("custom:missing", false)).toThrow(
      "Custom theme custom:missing is not registered.",
    );
  });
});
