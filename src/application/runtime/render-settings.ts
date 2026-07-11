import {
  createKeybindingSettings,
  type KeybindingSettings,
} from "../commands/default-keybindings";
import type { Quality } from "../engine/contracts";
import {
  defaultPersistedSettings,
  type EditorPreferences,
  type PersistedSettings,
} from "../settings/settings-schema";
import type { ThemePreference } from "../theme/theme-runtime";

export interface RenderingSettings {
  autoRender: boolean;
  defaultQuality: Quality;
  renderDebounceMs: number;
  previewTimeoutMs: number;
  fullTimeoutMs: number;
  previewFacetLimit: number;
}

export type EditorSettings = EditorPreferences;

export const DEFAULT_EDITOR_SETTINGS: Readonly<EditorSettings> = Object.freeze(
  defaultPersistedSettings().editor,
);

export interface SettingsState extends RenderingSettings {
  theme: ThemePreference;
  engineAvailable: boolean;
  editor: Readonly<EditorSettings>;
  keybindings: KeybindingSettings;
  profile: PersistedSettings;
}

export function settingsStateFromProfile(
  profile: PersistedSettings,
  engineAvailable = false,
): SettingsState {
  return {
    profile,
    theme: profile.theme.preference,
    editor: profile.editor,
    keybindings: profile.keybindings,
    autoRender: profile.rendering.autoRender,
    defaultQuality: profile.rendering.defaultQuality,
    engineAvailable,
    renderDebounceMs: profile.rendering.renderDebounceMs,
    previewTimeoutMs: profile.rendering.previewTimeoutMs,
    fullTimeoutMs: profile.rendering.fullTimeoutMs,
    previewFacetLimit: profile.rendering.previewFacetLimit,
  };
}

export function createSettingsState(
  rendering: Partial<RenderingSettings> = {},
  keybindings: Partial<KeybindingSettings> = {},
  persisted?: PersistedSettings,
): SettingsState {
  const base = persisted ?? defaultPersistedSettings();
  const profile: PersistedSettings = {
    ...base,
    rendering: { ...base.rendering, ...rendering },
    keybindings: createKeybindingSettings({ ...base.keybindings, ...keybindings }),
  };
  return settingsStateFromProfile(profile);
}
