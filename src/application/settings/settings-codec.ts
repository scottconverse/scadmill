import {
  createKeybindingSettings,
  DEFAULT_KEYBINDINGS,
  type KeybindingSettings,
} from "../commands/default-keybindings";
import {
  defaultPersistedSettings,
  type PersistedSettings,
  type SettingsSection,
} from "./settings-schema";
import { parseCustomThemeJson } from "../theme/custom-theme";
import { customThemePreference } from "../theme/theme-registry";
import { DEFAULT_AI_SECRET_SCOPE } from "./secret-store";

type UnknownRecord = Record<string, unknown>;

export const SETTINGS_SIZE_LIMIT_BYTES = 1_048_576;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return finiteInRange(value, minimum, maximum) && Number.isInteger(value);
}

function validEditor(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(value, ["fontFamily", "fontSize", "tabWidth", "wordWrap", "lineNumbers", "minimap"])
    && typeof value.fontFamily === "string"
    && value.fontFamily.length > 0
    && value.fontFamily.length <= 512
    && integerInRange(value.fontSize, 8, 48)
    && integerInRange(value.tabWidth, 1, 8)
    && typeof value.wordWrap === "boolean"
    && typeof value.lineNumbers === "boolean"
    && typeof value.minimap === "boolean";
}

function validRendering(value: unknown): boolean {
  return isRecord(value)
    && exactKeys(value, [
      "autoRender",
      "renderDebounceMs",
      "previewTimeoutMs",
      "fullTimeoutMs",
      "previewFacetLimit",
      "defaultQuality",
    ])
    && typeof value.autoRender === "boolean"
    && integerInRange(value.renderDebounceMs, 0, 10_000)
    && integerInRange(value.previewTimeoutMs, 1_000, 3_600_000)
    && integerInRange(value.fullTimeoutMs, 1_000, 3_600_000)
    && integerInRange(value.previewFacetLimit, 3, 10_000)
    && (value.defaultQuality === "preview" || value.defaultQuality === "full");
}

function validViewer(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, [
    "projection",
    "orbitButton",
    "panButton",
    "showGrid",
    "showAxes",
    "showEdges",
    "showShadow",
    "meshColor",
  ])) return false;
  const mouseButtons = ["left", "middle", "right"];
  return (value.projection === "perspective" || value.projection === "orthographic")
    && mouseButtons.includes(value.orbitButton as string)
    && mouseButtons.includes(value.panButton as string)
    && value.orbitButton !== value.panButton
    && typeof value.showGrid === "boolean"
    && typeof value.showAxes === "boolean"
    && typeof value.showEdges === "boolean"
    && typeof value.showShadow === "boolean"
    && (value.meshColor === null || (typeof value.meshColor === "string" && value.meshColor.length <= 128));
}

function validKeybindings(value: unknown): value is KeybindingSettings {
  if (!isRecord(value) || !exactKeys(value, Object.keys(DEFAULT_KEYBINDINGS))) return false;
  if (!Object.values(value).every((binding) => typeof binding === "string")) return false;
  try {
    createKeybindingSettings(value as Partial<KeybindingSettings>);
    return true;
  } catch {
    return false;
  }
}

function validTheme(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, ["preference", "customThemes"])) return false;
  if (!Array.isArray(value.customThemes) || value.customThemes.length > 32) return false;
  const preferences = new Set<string>();
  for (const candidate of value.customThemes) {
    const parsed = parseCustomThemeJson(JSON.stringify(candidate));
    if (!parsed.ok) return false;
    const preference = customThemePreference(parsed.theme.meta.name);
    if (preferences.has(preference)) return false;
    preferences.add(preference);
  }
  if (["system", "light", "dark", "high-contrast"].includes(value.preference as string)) {
    return true;
  }
  return typeof value.preference === "string" && preferences.has(value.preference);
}

function validate(value: unknown): value is PersistedSettings {
  if (!isRecord(value) || !exactKeys(value, [
    "version",
    "editor",
    "rendering",
    "engine",
    "viewer",
    "formatter",
    "theme",
    "ai",
    "keybindings",
    "privacy",
  ])) return false;
  return value.version === 1
    && validEditor(value.editor)
    && validRendering(value.rendering)
    && isRecord(value.engine)
    && exactKeys(value.engine, ["executablePath"])
    && typeof value.engine.executablePath === "string"
    && value.engine.executablePath.length <= 32_768
    && validViewer(value.viewer)
    && isRecord(value.formatter)
    && exactKeys(value.formatter, ["indentSize", "formatOnSave"])
    && integerInRange(value.formatter.indentSize, 1, 8)
    && typeof value.formatter.formatOnSave === "boolean"
    && validTheme(value.theme)
    && isRecord(value.ai)
    && exactKeys(value.ai, ["provider", "endpoint", "model", "models", "configurations", "persistWebSecret"])
    && ["none", "openai", "anthropic", "compatible", "local"].includes(value.ai.provider as string)
    && typeof value.ai.endpoint === "string"
    && value.ai.endpoint.length <= 2_048
    && typeof value.ai.model === "string"
    && value.ai.model.length <= 512
    && Array.isArray(value.ai.models)
    && value.ai.models.length <= 32
    && value.ai.models.every((model) => typeof model === "string" && model === model.trim() && model.length > 0 && model.length <= 512)
    && new Set(value.ai.models).size === value.ai.models.length
    && Array.isArray(value.ai.configurations)
    && value.ai.configurations.length <= 16
    && value.ai.configurations.every((configuration) => isRecord(configuration)
      && exactKeys(configuration, ["id", "label", "provider", "endpoint", "model"])
      && typeof configuration.id === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(configuration.id)
      && configuration.id !== DEFAULT_AI_SECRET_SCOPE
      && typeof configuration.label === "string" && configuration.label === configuration.label.trim() && configuration.label.length > 0 && configuration.label.length <= 128
      && ["openai", "anthropic", "compatible", "local"].includes(configuration.provider as string)
      && typeof configuration.endpoint === "string" && configuration.endpoint.length <= 2_048
      && typeof configuration.model === "string" && configuration.model === configuration.model.trim() && configuration.model.length > 0 && configuration.model.length <= 512)
    && new Set(value.ai.configurations.map((configuration) => (configuration as UnknownRecord).id)).size === value.ai.configurations.length
    && typeof value.ai.persistWebSecret === "boolean"
    && validKeybindings(value.keybindings)
    && isRecord(value.privacy)
    && exactKeys(value.privacy, ["updateChecks"])
    && typeof value.privacy.updateChecks === "boolean";
}

function migrateLegacyAiModels(value: unknown): unknown {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.ai)) return value;
  if (exactKeys(value.ai, ["provider", "endpoint", "model", "persistWebSecret"])) {
    const model = typeof value.ai.model === "string" ? value.ai.model.trim() : "";
    return { ...value, ai: { ...value.ai, model, models: model ? [model] : [], configurations: [] } };
  }
  if (!exactKeys(value.ai, ["provider", "endpoint", "model", "models", "persistWebSecret"])) return value;
  const model = typeof value.ai.model === "string" ? value.ai.model.trim() : "";
  const models = Array.isArray(value.ai.models)
    ? [...new Set(value.ai.models.flatMap((candidate) => typeof candidate === "string" && candidate.trim() ? [candidate.trim()] : []))]
    : model ? [model] : [];
  return { ...value, ai: { ...value.ai, model, models, configurations: [] } };
}

export function createDefaultPersistedSettings(): PersistedSettings {
  return defaultPersistedSettings();
}

export function parsePersistedSettings(source: string): PersistedSettings {
  if (new TextEncoder().encode(source).byteLength > SETTINGS_SIZE_LIMIT_BYTES) {
    throw new Error("Settings exceed the supported size.");
  }
  let parsed: unknown;
  try {
    parsed = migrateLegacyAiModels(JSON.parse(source));
  } catch {
    throw new Error("Settings file is not valid JSON.");
  }
  if (!validate(parsed)) throw new Error("Settings file does not match the exact version-1 schema.");
  return {
    ...parsed,
    keybindings: createKeybindingSettings(parsed.keybindings),
  };
}

export function serializePersistedSettings(settings: PersistedSettings): string {
  return `${JSON.stringify(parsePersistedSettings(JSON.stringify(settings)), null, 2)}\n`;
}

export function restoreSettingsSection(
  settings: PersistedSettings,
  section: SettingsSection,
): PersistedSettings {
  const defaults = defaultPersistedSettings();
  return { ...settings, [section]: defaults[section] };
}
