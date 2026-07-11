import { useRef, useState } from "react";

import { SETTINGS_SIZE_LIMIT_BYTES } from "../../application/settings/settings-codec";
import type { ThemePreferences } from "../../application/settings/settings-schema";
import { parseCustomThemeJson } from "../../application/theme/custom-theme";
import { customThemePreference } from "../../application/theme/theme-registry";
import { messages } from "../../messages/en";

export interface CustomThemeSettingsProps {
  readonly theme: ThemePreferences;
  readonly onChange: (theme: ThemePreferences) => void;
}

export function CustomThemeSettings({ theme, onChange }: CustomThemeSettingsProps) {
  const request = useRef(0);
  const [importError, setImportError] = useState(false);

  const importTheme = (file: File) => {
    const requestId = ++request.current;
    if (file.size > SETTINGS_SIZE_LIMIT_BYTES) {
      setImportError(true);
      return;
    }
    void file.text().then((source) => {
      if (requestId !== request.current) return;
      const parsed = parseCustomThemeJson(source);
      if (!parsed.ok) {
        setImportError(true);
        return;
      }
      const preference = customThemePreference(parsed.theme.meta.name);
      const customThemes = theme.customThemes.filter(
        (candidate) => customThemePreference(candidate.meta.name) !== preference,
      );
      onChange({ preference, customThemes: [...customThemes, parsed.theme] });
      setImportError(false);
    }).catch(() => {
      if (requestId === request.current) setImportError(true);
    });
  };

  return (
    <>
      <label className="setting-row">
        <span>{messages.themeLabel}</span>
        <select
          aria-label={messages.themeLabel}
          value={theme.preference}
          onChange={(event) => onChange({
            ...theme,
            preference: event.currentTarget.value as ThemePreferences["preference"],
          })}
        >
          <option value="system">{messages.themeSystem}</option>
          <option value="light">{messages.themeLight}</option>
          <option value="dark">{messages.themeDark}</option>
          <option value="high-contrast">{messages.themeHighContrast}</option>
          {theme.customThemes.map((candidate) => (
            <option
              key={candidate.meta.name}
              value={customThemePreference(candidate.meta.name)}
            >{candidate.meta.name}</option>
          ))}
        </select>
      </label>
      <label className="settings-import">
        <span>{messages.importCustomTheme}</span>
        <input
          accept="application/json,.json"
          aria-label={messages.importCustomTheme}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) importTheme(file);
          }}
          type="file"
        />
      </label>
      {importError && <p role="alert">{messages.customThemeImportFailed}</p>}
    </>
  );
}
