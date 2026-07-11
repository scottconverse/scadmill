import type { RefObject } from "react";

import type { ThemePreference } from "../../application/theme/theme-runtime";
import { messages } from "../../messages/en";
import type { CursorPosition } from "../editor/CodeEditor";

export interface LegacyWorkbenchStatusBarProps {
  consoleButtonRef: RefObject<HTMLButtonElement | null>;
  consoleVisible: boolean;
  cursor: CursorPosition;
  diagnosticStatus: string;
  engineLabel: string;
  renderStatus: string;
  themePreference: ThemePreference;
  onFocusConsole(): void;
  onThemePreferenceChange(preference: ThemePreference): void;
}

export function LegacyWorkbenchStatusBar({
  consoleButtonRef,
  consoleVisible,
  cursor,
  diagnosticStatus,
  engineLabel,
  renderStatus,
  themePreference,
  onFocusConsole,
  onThemePreferenceChange,
}: LegacyWorkbenchStatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="status-engine">{engineLabel}</span>
      <span className="status-render">{renderStatus}</span>
      <button
        aria-label={messages.focusConsoleStatus(diagnosticStatus)}
        aria-pressed={consoleVisible}
        className="status-chip status-diagnostics"
        onClick={onFocusConsole}
        ref={consoleButtonRef}
        type="button"
      >
        {diagnosticStatus}
      </button>
      <span className="status-cursor">{messages.cursorPosition(cursor.line, cursor.column)}</span>
      <span className="status-encoding">{messages.untitledStatus}</span>
      <label className="theme-picker">
        <span>{messages.themeLabel}</span>
        <select
          aria-label={messages.themeLabel}
          value={themePreference}
          onChange={(event) =>
            onThemePreferenceChange(event.currentTarget.value as ThemePreference)
          }
        >
          <option value="system">{messages.themeSystem}</option>
          <option value="light">{messages.themeLight}</option>
          <option value="dark">{messages.themeDark}</option>
          <option value="high-contrast">{messages.themeHighContrast}</option>
        </select>
      </label>
    </footer>
  );
}
