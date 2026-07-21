import { describe, expect, it } from "vitest";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { parseThemeJson } from "../../../src/application/theme/theme-loader";

const isOpaqueHex = (value: string) => /^#[0-9a-f]{6}$/iu.test(value);

describe("parseThemeJson", () => {
  it("returns a typed theme after shape and injected CSS-color validation", () => {
    const source = JSON.stringify(SHIPPED_THEMES[0]);

    const result = parseThemeJson(source, isOpaqueHex);

    expect(result).toEqual({ ok: true, theme: SHIPPED_THEMES[0] });
  });

  it("reports malformed JSON without throwing", () => {
    const result = parseThemeJson("{ not-json", isOpaqueHex);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ code: "invalid-json", path: "$" }),
      ]);
    }
  });

  it("reports an object that does not match the exact Appendix C shape", () => {
    const incomplete: Record<string, unknown> = JSON.parse(JSON.stringify(SHIPPED_THEMES[0]));
    delete incomplete.chrome;

    const result = parseThemeJson(JSON.stringify(incomplete), isOpaqueHex);

    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "invalid-schema", path: "$" })],
    });
  });

  it("reports each token rejected by the injected CSS-color validator", () => {
    const invalid: { chrome: { accent: string }; console: { warning: string } } = JSON.parse(
      JSON.stringify(SHIPPED_THEMES[0]),
    );
    invalid.chrome.accent = "not-a-color";
    invalid.console.warning = "also-not-a-color";

    const result = parseThemeJson(JSON.stringify(invalid), isOpaqueHex);

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({ code: "invalid-color", path: "chrome.accent" }),
        expect.objectContaining({ code: "invalid-color", path: "console.warning" }),
      ],
    });
  });
});
