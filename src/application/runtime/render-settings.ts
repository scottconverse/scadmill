import type { ThemePreference } from "../theme/theme-runtime";
import {
  createKeybindingSettings,
  type KeybindingSettings,
} from "../commands/default-keybindings";

export interface RenderingSettings {
  autoRender: boolean;
  renderDebounceMs: number;
  previewTimeoutMs: number;
  fullTimeoutMs: number;
  previewFacetLimit: number;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  tabWidth: number;
  wordWrap: boolean;
  lineNumbers: boolean;
  minimap: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: Readonly<EditorSettings> = Object.freeze({
  fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
  fontSize: 14,
  tabWidth: 4,
  wordWrap: false,
  lineNumbers: true,
  minimap: false,
});

export interface SettingsState extends RenderingSettings {
  theme: ThemePreference;
  engineAvailable: boolean;
  editor: Readonly<EditorSettings>;
  keybindings: KeybindingSettings;
}

export function createSettingsState(
  rendering: Partial<RenderingSettings> = {},
  keybindings: Partial<KeybindingSettings> = {},
): SettingsState {
  return {
    theme: "system",
    editor: DEFAULT_EDITOR_SETTINGS,
    keybindings: createKeybindingSettings(keybindings),
    autoRender: rendering.autoRender ?? true,
    engineAvailable: false,
    renderDebounceMs: rendering.renderDebounceMs ?? 800,
    previewTimeoutMs: rendering.previewTimeoutMs ?? 30_000,
    fullTimeoutMs: rendering.fullTimeoutMs ?? 600_000,
    previewFacetLimit: rendering.previewFacetLimit ?? 48,
  };
}
