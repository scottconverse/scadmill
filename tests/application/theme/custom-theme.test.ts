import { describe, expect, it } from "vitest";

import { parseCustomThemeJson } from "../../../src/application/theme/custom-theme";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";

function customTheme() {
  return {
    ...SHIPPED_THEMES[0],
    meta: { name: "Workshop blue", kind: "dark" as const, version: 1 as const },
  };
}

describe("custom theme import policy", () => {
  it("accepts an exact Appendix C theme with opaque sRGB tokens and conservative AA contrast", () => {
    expect(parseCustomThemeJson(JSON.stringify(customTheme()))).toEqual({
      ok: true,
      theme: customTheme(),
    });
  });

  it("rejects non-opaque tokens while Q-0006 is open", () => {
    const theme = customTheme();
    const invalid = { ...theme, chrome: { ...theme.chrome, accent: "rgba(0, 0, 0, 0.5)" } };

    const result = parseCustomThemeJson(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid-color", path: "chrome.accent" }),
    );
  });

  it("rejects a theme that collapses required text contrast", () => {
    const theme = customTheme();
    const invalid = {
      ...theme,
      chrome: { ...theme.chrome, text: theme.chrome.background },
    };

    const result = parseCustomThemeJson(JSON.stringify(invalid));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "invalid-contrast", path: "chrome-text-background" }),
    );
  });
});
