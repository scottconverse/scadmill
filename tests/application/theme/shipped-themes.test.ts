import { describe, expect, it } from "vitest";

import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { validateThemeTokens } from "../../../src/application/theme/theme-schema";

function colorValues(value: unknown, path = ""): Array<{ path: string; value: string }> {
  if (typeof value === "string" && path !== "meta.name" && path !== "meta.kind") {
    return [{ path, value }];
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    colorValues(nested, path ? `${path}.${key}` : key),
  );
}

describe("shipped themes", () => {
  it("ships exactly one complete theme for each required kind", () => {
    expect(SHIPPED_THEMES).toHaveLength(3);
    expect(SHIPPED_THEMES.map((theme) => theme.meta.kind).sort()).toEqual([
      "dark",
      "high-contrast",
      "light",
    ]);
    expect(new Set(SHIPPED_THEMES.map((theme) => theme.meta.name)).size).toBe(3);
    for (const theme of SHIPPED_THEMES) {
      expect(validateThemeTokens(theme), theme.meta.name).toBe(true);
    }
  });

  it("uses opaque six-digit sRGB tokens for deterministic contrast checks", () => {
    for (const theme of SHIPPED_THEMES) {
      for (const token of colorValues(theme)) {
        expect(token.value, `${theme.meta.name}:${token.path}`).toMatch(/^#[0-9a-f]{6}$/iu);
      }
    }
  });
});
