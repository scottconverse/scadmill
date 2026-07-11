import {
  createKeybindingSettings,
  type KeybindingSettings,
} from "../commands/default-keybindings";
import type { ThemePreference } from "../theme/theme-runtime";
import type { ThemeTokens } from "../theme/theme-schema";

export interface EditorPreferences {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly tabWidth: number;
  readonly wordWrap: boolean;
  readonly lineNumbers: boolean;
  readonly minimap: boolean;
}

export interface RenderingPreferences {
  readonly autoRender: boolean;
  readonly renderDebounceMs: number;
  readonly previewTimeoutMs: number;
  readonly fullTimeoutMs: number;
  readonly previewFacetLimit: number;
  readonly defaultQuality: "preview" | "full";
}

export interface EnginePreferences {
  readonly executablePath: string;
}

export interface ViewerPreferences {
  readonly projection: "perspective" | "orthographic";
  readonly orbitButton: "left" | "middle" | "right";
  readonly panButton: "left" | "middle" | "right";
  readonly showGrid: boolean;
  readonly showAxes: boolean;
  readonly showEdges: boolean;
  readonly showShadow: boolean;
  readonly meshColor: string | null;
}

export interface FormatterPreferences {
  readonly indentSize: number;
  readonly formatOnSave: boolean;
}

export interface ThemePreferences {
  readonly preference: ThemePreference;
  readonly customThemes: readonly ThemeTokens[];
}

export interface AiPreferences {
  readonly provider: "none" | "openai" | "anthropic" | "compatible" | "local";
  readonly endpoint: string;
  readonly model: string;
  readonly persistWebSecret: boolean;
}

export interface PrivacyPreferences {
  readonly updateChecks: boolean;
}

export interface PersistedSettings {
  readonly version: 1;
  readonly editor: EditorPreferences;
  readonly rendering: RenderingPreferences;
  readonly engine: EnginePreferences;
  readonly viewer: ViewerPreferences;
  readonly formatter: FormatterPreferences;
  readonly theme: ThemePreferences;
  readonly ai: AiPreferences;
  readonly keybindings: KeybindingSettings;
  readonly privacy: PrivacyPreferences;
}

export type SettingsSection = Exclude<keyof PersistedSettings, "version">;

export function defaultPersistedSettings(): PersistedSettings {
  return {
    version: 1,
    editor: {
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 14,
      tabWidth: 4,
      wordWrap: false,
      lineNumbers: true,
      minimap: false,
    },
    rendering: {
      autoRender: true,
      renderDebounceMs: 800,
      previewTimeoutMs: 30_000,
      fullTimeoutMs: 600_000,
      previewFacetLimit: 48,
      defaultQuality: "preview",
    },
    engine: { executablePath: "" },
    viewer: {
      projection: "perspective",
      orbitButton: "left",
      panButton: "right",
      showGrid: true,
      showAxes: true,
      showEdges: true,
      showShadow: false,
      meshColor: null,
    },
    formatter: { indentSize: 4, formatOnSave: false },
    theme: { preference: "system", customThemes: [] },
    ai: { provider: "none", endpoint: "", model: "", persistWebSecret: false },
    keybindings: createKeybindingSettings(),
    privacy: { updateChecks: false },
  };
}
