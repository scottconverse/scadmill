import { describe, expect, it } from "vitest";
import {
  createDefaultPersistedSettings,
  parsePersistedSettings,
  restoreSettingsSection,
  serializePersistedSettings,
} from "../../../src/application/settings/settings-codec";
import { customThemePreference } from "../../../src/application/theme/theme-registry";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";

describe("versioned settings JSON", () => {
  it("keeps per-project render-cache consent out of portable global settings", () => {
    const settings = createDefaultPersistedSettings();

    expect(settings.rendering).not.toHaveProperty("diskRenderCacheEnabled");
    expect(serializePersistedSettings(settings)).not.toContain("diskRenderCacheEnabled");
  });

  it("keeps update checks off until the user explicitly enables them", () => {
    expect(createDefaultPersistedSettings().privacy.updateChecks).toBe(false);
  });

  it("round-trips every non-secret section exactly", () => {
    const settings = createDefaultPersistedSettings();
    const changed = {
      ...settings,
      editor: {
        fontFamily: "Example Mono",
        fontSize: 18,
        tabWidth: 2,
        wordWrap: true,
        lineNumbers: false,
        minimap: true,
      },
      rendering: {
        autoRender: false,
        renderDebounceMs: 1200,
        previewTimeoutMs: 45_000,
        fullTimeoutMs: 700_000,
        previewFacetLimit: 64,
        defaultQuality: "full" as const,
      },
      engine: { executablePath: "C:/OpenSCAD/openscad.exe" },
      viewer: {
        projection: "orthographic" as const,
        orbitButton: "middle" as const,
        panButton: "left" as const,
        showGrid: false,
        showAxes: false,
        showEdges: false,
        showShadow: true,
        meshColor: "rebeccapurple",
      },
      formatter: { indentSize: 2, formatOnSave: true },
      theme: { ...settings.theme, preference: "high-contrast" as const },
      ai: { provider: "compatible" as const, endpoint: "https://ai.invalid/v1", model: "local", persistWebSecret: true },
      keybindings: { ...settings.keybindings, renderPreview: "Ctrl+F5" },
      privacy: { updateChecks: false },
    };

    expect(parsePersistedSettings(serializePersistedSettings(changed))).toEqual(changed);
    expect(serializePersistedSettings(changed)).not.toContain("apiKey");
  });

  it("round-trips a selected custom theme as part of the non-secret profile", () => {
    const settings = createDefaultPersistedSettings();
    const theme = {
      ...SHIPPED_THEMES[0],
      meta: { name: "Workshop blue", kind: "dark" as const, version: 1 as const },
    };
    const changed = {
      ...settings,
      theme: {
        preference: customThemePreference(theme.meta.name),
        customThemes: [theme],
      },
    };

    expect(parsePersistedSettings(serializePersistedSettings(changed))).toEqual(changed);
  });

  it("rejects a custom preference whose theme payload is absent", () => {
    const settings = createDefaultPersistedSettings();
    const invalid = {
      ...settings,
      theme: { preference: "custom:missing", customThemes: [] },
    };

    expect(() => parsePersistedSettings(JSON.stringify(invalid))).toThrow("exact version-1 schema");
  });

  it.each([
    "{",
    JSON.stringify({ version: 2 }),
    JSON.stringify({ ...createDefaultPersistedSettings(), extra: true }),
    JSON.stringify({ ...createDefaultPersistedSettings(), rendering: { autoRender: true } }),
    JSON.stringify({ ...createDefaultPersistedSettings(), editor: { ...createDefaultPersistedSettings().editor, fontSize: Number.NaN } }),
    JSON.stringify({ ...createDefaultPersistedSettings(), viewer: { ...createDefaultPersistedSettings().viewer, projection: "fish-eye" } }),
    JSON.stringify({ ...createDefaultPersistedSettings(), keybindings: { ...createDefaultPersistedSettings().keybindings, renderFull: "" } }),
    JSON.stringify({ ...createDefaultPersistedSettings(), rendering: { ...createDefaultPersistedSettings().rendering, renderDebounceMs: 1.5 } }),
  ])("rejects malformed or non-exact settings atomically", (source) => {
    expect(() => parsePersistedSettings(source)).toThrow();
  });

  it("rejects an oversized document before treating it as an importable profile", () => {
    const source = `${serializePersistedSettings(createDefaultPersistedSettings())}${" ".repeat(1_048_576)}`;

    expect(() => parsePersistedSettings(source)).toThrow("supported size");
  });

  it("restores one section without changing the others", () => {
    const defaults = createDefaultPersistedSettings();
    const changed = {
      ...defaults,
      editor: { ...defaults.editor, fontSize: 20 },
      privacy: { updateChecks: false },
    };
    const restored = restoreSettingsSection(changed, "editor");

    expect(restored.editor).toEqual(defaults.editor);
    expect(restored.privacy.updateChecks).toBe(false);
  });
});
