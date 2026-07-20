import type { ReactNode, RefObject } from "react";

import type { ThemePreference } from "../../application/theme/theme-runtime";
import type { ThemeTokens } from "../../application/theme/theme-schema";
import { messages } from "../../messages/en";
import type { CursorPosition } from "../editor/CodeEditor";

export interface WorkbenchStatusBarProps {
  readonly customThemes: readonly ThemeTokens[];
  readonly cursor: CursorPosition;
  readonly diagnosticStatus: string;
  readonly engineLabel: string;
  readonly geometryStatus: { readonly detail: string; readonly summary: string } | null;
  readonly mcpConnected?: boolean;
  readonly renderStatus: ReactNode;
  readonly consoleVisible: boolean;
  readonly consoleButtonRef: RefObject<HTMLButtonElement | null>;
  readonly themePreference: ThemePreference;
  readonly themePreferenceDisabled?: boolean;
  readonly onFocusConsole: () => void;
  readonly onThemePreferenceChange: (preference: ThemePreference) => void;
}

export function WorkbenchStatusBar(props: WorkbenchStatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="status-engine">{props.engineLabel}</span>
      <span className="status-render">{props.renderStatus}</span>
      <span
        aria-label={messages.mcpConnectionStatus}
        aria-live="polite"
        className={props.mcpConnected
          ? "external-agent-badge status-mcp"
          : "visually-hidden status-mcp"}
        role="status"
      >
        {props.mcpConnected ? messages.mcpClientConnected : messages.mcpClientDisconnected}
      </span>
      {props.geometryStatus && (
        props.geometryStatus.detail === props.geometryStatus.summary
          ? <span className="status-geometry">{props.geometryStatus.detail}</span>
          : (
            <details className="status-geometry">
              <summary aria-label={props.geometryStatus.detail}>{props.geometryStatus.summary}</summary>
              <div className="status-geometry-detail" role="status">
                {props.geometryStatus.detail}
              </div>
            </details>
          )
      )}
      <button
        aria-label={messages.focusConsoleStatus(props.diagnosticStatus)}
        aria-pressed={props.consoleVisible}
        className="status-chip status-diagnostics"
        onClick={props.onFocusConsole}
        ref={props.consoleButtonRef}
        type="button"
      >
        {props.diagnosticStatus}
      </button>
      <span className="status-cursor">
        {messages.cursorPosition(props.cursor.line, props.cursor.column)}
      </span>
      <span className="status-encoding">{messages.untitledStatus}</span>
      <label className="theme-picker">
        <span>{messages.themeLabel}</span>
        <select
          aria-label={messages.themeLabel}
          disabled={props.themePreferenceDisabled}
          value={props.themePreference}
          onChange={(event) => {
            if (!props.themePreferenceDisabled) {
              props.onThemePreferenceChange(event.currentTarget.value as ThemePreference);
            }
          }}
        >
          <option value="system">{messages.themeSystem}</option>
          <option value="light">{messages.themeLight}</option>
          <option value="dark">{messages.themeDark}</option>
          <option value="high-contrast">{messages.themeHighContrast}</option>
          {props.customThemes.map((theme) => (
            <option key={theme.meta.name} value={`custom:${encodeURIComponent(theme.meta.name)}`}>
              {theme.meta.name}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
