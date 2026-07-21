import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactElement, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createKeybindingSettings, type KeybindingCommand } from "../../application/commands/default-keybindings";
import { parsePersistedSettings, serializePersistedSettings, SETTINGS_SIZE_LIMIT_BYTES } from "../../application/settings/settings-codec";
import type { PersistedSettings, SettingsSection } from "../../application/settings/settings-schema";
import type { SecretStore } from "../../application/settings/secret-store";
import type { McpPermission, McpToolPermissionState } from "../../application/mcp/mcp-tools";
import { messages } from "../../messages/en";
import { McpPermissionSettings } from "./McpPermissionSettings";
import { CustomThemeSettings } from "./CustomThemeSettings";
import { KeybindingSettingsFields } from "./KeybindingSettingsFields";
import { AiProviderConfigurations } from "./AiProviderConfigurations";
import { type SettingsUpdater, useAiSecretController } from "./use-ai-secret";
import type { EngineVersionManagerPort } from "../../application/engine/engine-version-manager";
import { EngineVersionSettings } from "./EngineVersionSettings";
export interface SettingsDialogProps {
  readonly engineLabel: string;
  readonly secretStore: SecretStore;
  readonly settings: PersistedSettings;
  readonly onChange: (settings: PersistedSettings) => void;
  readonly onCommit?: (update: SettingsUpdater) => Promise<void>;
  readonly onClose: () => void;
  readonly onRestore: (section: SettingsSection) => void | Promise<void>;
  readonly persistenceError?: string;
  readonly settingsMutationsBlocked?: boolean;
  readonly settingsMutationInFlight?: boolean;
  readonly renderDiskCacheAvailable?: boolean;
  readonly projectDiskRenderCacheEligible?: boolean;
  readonly projectDiskRenderCacheEnabled?: boolean;
  readonly onProjectDiskRenderCacheChange?: (enabled: boolean) => void | Promise<void>;
  readonly onClearProjectDiskRenderCache?: () => void | Promise<void>;
  readonly mcpAvailable?: boolean;
  readonly mcpEnabled?: boolean;
  readonly onMcpEnabledChange?: (enabled: boolean) => void;
  readonly mcpPermissions?: McpToolPermissionState;
  readonly onMcpPermissionChange?: (tool: "write_file" | "set_parameters", permission: McpPermission) => void;
  readonly engineVersionManager?: EngineVersionManagerPort;
  readonly projectMode?: boolean;
  readonly projectEnginePin?: string;
  readonly onPinProjectEngine?: (version: string) => Promise<void>;
  readonly onEngineInventoryChanged?: () => void;
}
const SECTION_TITLES: Readonly<Record<SettingsSection, string>> = {
  editor: messages.settingsEditor,
  rendering: messages.settingsRendering,
  engine: messages.settingsEngine,
  viewer: messages.settingsViewer,
  formatter: messages.settingsFormatter,
  theme: messages.settingsTheme,
  ai: messages.settingsAi,
  keybindings: messages.settingsKeybindings,
  privacy: messages.settingsPrivacy,
};
const MOUSE_BUTTONS = ["left", "middle", "right"] as const;
function Setting({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;
  return <label className="setting-row" htmlFor={id}><span>{label}</span>{control}</label>;
}
function Section({
  section,
  onRestore,
  restoreDisabled = false,
  children,
}: {
  readonly section: SettingsSection;
  readonly onRestore: (section: SettingsSection) => void;
  readonly restoreDisabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className="settings-section" aria-labelledby={`settings-${section}`}>
      <header>
        <h3 id={`settings-${section}`}>{SECTION_TITLES[section]}</h3>
        <button
          aria-label={messages.restoreSectionDefaults(section)}
          disabled={restoreDisabled}
          onClick={() => onRestore(section)}
          type="button"
        >{messages.restoreDefaults}</button>
      </header>
      {children}
    </section>
  );
}
function numericValue(value: string, minimum: number, maximum: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}
export function SettingsDialog({
  engineLabel,
  secretStore,
  settings,
  onChange,
  onCommit,
  onClose,
  onRestore,
  persistenceError,
  settingsMutationsBlocked = false,
  settingsMutationInFlight = false,
  renderDiskCacheAvailable = false,
  projectDiskRenderCacheEligible = false,
  projectDiskRenderCacheEnabled = false,
  onProjectDiskRenderCacheChange,
  onClearProjectDiskRenderCache,
  mcpAvailable = false,
  mcpEnabled = false,
  onMcpEnabledChange,
  mcpPermissions,
  onMcpPermissionChange,
  engineVersionManager,
  projectMode = false,
  projectEnginePin,
  onPinProjectEngine = async () => undefined,
  onEngineInventoryChanged,
}: SettingsDialogProps) {
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const importRequest = useRef(0);
  const [importError, setImportError] = useState(false);
  const [keybindingError, setKeybindingError] = useState<string | null>(null);
  const [profileSecretMutations, setProfileSecretMutations] = useState(0);
  const aiSecret = useAiSecretController({
    blocked: settingsMutationsBlocked,
    onChange,
    onCommit,
    onMutationStart: () => { importRequest.current += 1; },
    onRestore,
    secretStore,
    settings,
  });
  const secretMutationInFlight = aiSecret.mutationInFlight || profileSecretMutations > 0;
  const closeBlocked = secretMutationInFlight || settingsMutationInFlight;
  const importBlocked = settingsMutationsBlocked || secretMutationInFlight;
  useEffect(() => searchInput.current?.focus(), []);
  const restoreSection = (section: SettingsSection) => {
    if (section === "ai") aiSecret.restore();
    else void Promise.resolve(onRestore(section)).catch(() => undefined);
  };
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (Object.keys(SECTION_TITLES) as SettingsSection[]).filter(
      (section) => !normalized || SECTION_TITLES[section].toLowerCase().includes(normalized),
    );
  }, [query]);
  const show = (section: SettingsSection) => visible.includes(section);
  const changeKeybinding = (command: KeybindingCommand, binding: string) => {
    try {
      const keybindings = createKeybindingSettings({ ...settings.keybindings, [command]: binding });
      setKeybindingError(null);
      onChange({ ...settings, keybindings });
    } catch {
      setKeybindingError(messages.keybindingRejected);
    }
  };
  const exportSettings = () => {
    const url = URL.createObjectURL(new Blob([serializePersistedSettings(settings)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "scadmill-settings.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!closeBlocked) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']:not(:disabled)",
    )];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <div className="settings-modal-layer">
    <div aria-label={messages.settingsTitle} aria-modal="true" className="settings-dialog" onKeyDown={handleDialogKeyDown} role="dialog">
      <header className="settings-dialog-header">
        <h2>{messages.settingsTitle}</h2>
        <button aria-label={messages.closeSettings} disabled={closeBlocked} onClick={onClose} type="button">×</button>
      </header>
      <div className="settings-portability">
        <label>
          <span>{messages.searchSettings}</span>
          <input
            aria-label={messages.searchSettings}
            onChange={(event) => setQuery(event.currentTarget.value)}
            ref={searchInput}
            type="search"
            value={query}
          />
        </label>
        <button aria-label={messages.exportSettings} onClick={exportSettings} type="button">
          {messages.exportSettings}
        </button>
        <label aria-disabled={importBlocked} className="settings-import">
          <span>{messages.importSettings}</span>
          <input
            accept="application/json,.json"
            aria-label={messages.importSettings}
            disabled={importBlocked}
            onChange={(event) => {
              if (importBlocked) return;
              const requestId = ++importRequest.current;
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              event.currentTarget.value = "";
              if (file.size > SETTINGS_SIZE_LIMIT_BYTES) {
                setImportError(true);
                return;
              }
              void file.text().then((source) => {
                if (requestId !== importRequest.current) return;
                try {
                  onChange(parsePersistedSettings(source));
                  setImportError(false);
                } catch {
                  setImportError(true);
                }
              }).catch(() => {
                if (requestId === importRequest.current) setImportError(true);
              });
            }}
            type="file"
          />
        </label>
      </div>
      <div className="settings-feedback">
        {importError && <p role="alert">{messages.settingsImportFailed}</p>}
        {persistenceError && <p role="alert">{persistenceError}</p>}
      </div>
      <fieldset className="settings-sections" disabled={settingsMutationsBlocked || secretMutationInFlight}>
        {show("editor") && (
          <Section section="editor" onRestore={restoreSection}>
            <Setting label={messages.editorFontFamily}><input aria-label={messages.editorFontFamily} maxLength={512} onChange={(event) => onChange({ ...settings, editor: { ...settings.editor, fontFamily: event.currentTarget.value } })} value={settings.editor.fontFamily} /></Setting>
            <Setting label={messages.editorFontSize}>
              <input
                aria-label={messages.editorFontSize}
                min={8}
                max={48}
                onChange={(event) => {
                  const fontSize = numericValue(event.currentTarget.value, 8, 48);
                  if (fontSize !== null) onChange({ ...settings, editor: { ...settings.editor, fontSize } });
                }}
                type="number"
                value={settings.editor.fontSize}
              />
            </Setting>
            <Setting label={messages.editorTabWidth}>
              <input
                aria-label={messages.editorTabWidth}
                min={1}
                max={8}
                onChange={(event) => {
                  const tabWidth = numericValue(event.currentTarget.value, 1, 8);
                  if (tabWidth !== null) onChange({ ...settings, editor: { ...settings.editor, tabWidth } });
                }}
                type="number"
                value={settings.editor.tabWidth}
              />
            </Setting>
            <Setting label={messages.wordWrap}>
              <input
                checked={settings.editor.wordWrap}
                onChange={(event) => onChange({ ...settings, editor: { ...settings.editor, wordWrap: event.currentTarget.checked } })}
                type="checkbox"
              />
            </Setting>
            <Setting label={messages.lineNumbers}><input checked={settings.editor.lineNumbers} onChange={(event) => onChange({ ...settings, editor: { ...settings.editor, lineNumbers: event.currentTarget.checked } })} type="checkbox" /></Setting>
            <Setting label={messages.minimap}><input checked={settings.editor.minimap} onChange={(event) => onChange({ ...settings, editor: { ...settings.editor, minimap: event.currentTarget.checked } })} type="checkbox" /></Setting>
          </Section>
        )}
        {show("rendering") && (
          <Section section="rendering" onRestore={restoreSection}>
            <Setting label={messages.autoRender}>
              <input checked={settings.rendering.autoRender} onChange={(event) => onChange({ ...settings, rendering: { ...settings.rendering, autoRender: event.currentTarget.checked } })} type="checkbox" />
            </Setting>
            {([
              ["renderDebounceMs", messages.renderDebounce, 0, 10_000],
              ["previewTimeoutMs", messages.previewTimeout, 1_000, 3_600_000],
              ["fullTimeoutMs", messages.fullTimeout, 1_000, 3_600_000],
              ["previewFacetLimit", messages.previewFacetLimit, 3, 10_000],
            ] as const).map(([key, label, minimum, maximum]) => (
              <Setting key={key} label={label}>
                <input
                  aria-label={label}
                  min={minimum}
                  max={maximum}
                  onChange={(event) => {
                    const value = numericValue(event.currentTarget.value, minimum, maximum);
                    if (value !== null) onChange({ ...settings, rendering: { ...settings.rendering, [key]: value } });
                  }}
                  type="number"
                  value={settings.rendering[key]}
                />
              </Setting>
            ))}
            <Setting label={messages.defaultRenderQuality}><select aria-label={messages.defaultRenderQuality} onChange={(event) => onChange({ ...settings, rendering: { ...settings.rendering, defaultQuality: event.currentTarget.value as "preview" | "full" } })} value={settings.rendering.defaultQuality}><option value="preview">{messages.renderQualityPreview}</option><option value="full">{messages.renderQualityFull}</option></select></Setting>
            {renderDiskCacheAvailable && (projectDiskRenderCacheEligible ? <>
              <Setting label={messages.diskRenderCache}><input aria-label={messages.diskRenderCache} checked={projectDiskRenderCacheEnabled} onChange={(event) => void Promise.resolve(onProjectDiskRenderCacheChange?.(event.currentTarget.checked)).catch(() => undefined)} type="checkbox" /></Setting>
              <p role="note">{messages.diskRenderCacheDisclosure}</p>
              <button onClick={() => void Promise.resolve(onClearProjectDiskRenderCache?.()).catch(() => undefined)} type="button">{messages.clearProjectDiskRenderCache}</button>
            </> : <p role="note">{messages.diskRenderCacheProjectRequired}</p>)}
          </Section>
        )}
        {show("engine") && (
          <Section section="engine" onRestore={restoreSection}>
            <Setting label={messages.enginePath}>
              <input aria-label={messages.enginePath} onChange={(event) => onChange({ ...settings, engine: { executablePath: event.currentTarget.value } })} type="text" value={settings.engine.executablePath} />
            </Setting>
            <output aria-label={messages.engineVersion}>{engineLabel}</output>
            <EngineVersionSettings manager={engineVersionManager} project={projectMode} projectPin={projectEnginePin} onPin={onPinProjectEngine} onInventoryChanged={onEngineInventoryChanged} />
          </Section>
        )}
        {show("viewer") && (
          <Section section="viewer" onRestore={restoreSection}>
            <Setting label={messages.viewerProjection}>
              <select aria-label={messages.viewerProjection} onChange={(event) => onChange({ ...settings, viewer: { ...settings.viewer, projection: event.currentTarget.value as "perspective" | "orthographic" } })} value={settings.viewer.projection}>
                <option value="perspective">{messages.projectionPerspective}</option><option value="orthographic">{messages.projectionOrthographic}</option>
              </select>
            </Setting>
            <Setting label={messages.viewerOrbitButton}><select aria-label={messages.viewerOrbitButton} onChange={(event) => onChange({ ...settings, viewer: { ...settings.viewer, orbitButton: event.currentTarget.value as PersistedSettings["viewer"]["orbitButton"] } })} value={settings.viewer.orbitButton}>{MOUSE_BUTTONS.filter((button) => button !== settings.viewer.panButton).map((button) => <option key={button} value={button}>{messages.viewerMouseButton(button)}</option>)}</select></Setting>
            <Setting label={messages.viewerPanButton}><select aria-label={messages.viewerPanButton} onChange={(event) => onChange({ ...settings, viewer: { ...settings.viewer, panButton: event.currentTarget.value as PersistedSettings["viewer"]["panButton"] } })} value={settings.viewer.panButton}>{MOUSE_BUTTONS.filter((button) => button !== settings.viewer.orbitButton).map((button) => <option key={button} value={button}>{messages.viewerMouseButton(button)}</option>)}</select></Setting>
            {(["showGrid", "showAxes", "showEdges", "showShadow"] as const).map((key) => (
              <Setting key={key} label={{ showGrid: messages.viewerGrid, showAxes: messages.viewerAxes, showEdges: messages.viewerEdges, showShadow: messages.viewerShadow }[key]}>
                <input checked={settings.viewer[key]} onChange={(event) => onChange({ ...settings, viewer: { ...settings.viewer, [key]: event.currentTarget.checked } })} type="checkbox" />
              </Setting>
            ))}
            <Setting label={messages.viewerMeshColor}><input aria-label={messages.viewerMeshColor} maxLength={128} onChange={(event) => onChange({ ...settings, viewer: { ...settings.viewer, meshColor: event.currentTarget.value || null } })} placeholder={messages.themeDefault} value={settings.viewer.meshColor ?? ""} /></Setting>
          </Section>
        )}
        {show("formatter") && (
          <Section section="formatter" onRestore={restoreSection}>
            <Setting label={messages.formatterIndent}><input aria-label={messages.formatterIndent} min={1} max={8} type="number" value={settings.formatter.indentSize} onChange={(event) => { const indentSize = numericValue(event.currentTarget.value, 1, 8); if (indentSize !== null) onChange({ ...settings, formatter: { ...settings.formatter, indentSize } }); }} /></Setting>
            <Setting label={messages.formatOnSave}><input checked={settings.formatter.formatOnSave} onChange={(event) => onChange({ ...settings, formatter: { ...settings.formatter, formatOnSave: event.currentTarget.checked } })} type="checkbox" /></Setting>
          </Section>
        )}
        {show("theme") && (
          <Section section="theme" onRestore={restoreSection}>
            <CustomThemeSettings
              theme={settings.theme}
              onChange={(theme) => onChange({ ...settings, theme })}
            />
          </Section>
        )}
        {show("ai") && (
          <Section section="ai" onRestore={restoreSection} restoreDisabled={aiSecret.locked || aiSecret.busy}>
            <Setting label={messages.aiProvider}><select aria-label={messages.aiProvider} value={settings.ai.provider} onChange={(event) => onChange({ ...settings, ai: { ...settings.ai, provider: event.currentTarget.value as PersistedSettings["ai"]["provider"] } })}><option value="none">{messages.aiProviderNone}</option><option value="openai">{messages.aiProviderOpenAi}</option><option value="anthropic">{messages.aiProviderAnthropic}</option><option value="compatible">{messages.aiProviderCompatible}</option><option value="local">{messages.aiProviderLocal}</option></select></Setting>
            <Setting label={messages.aiEndpoint}><input aria-label={messages.aiEndpoint} type="url" value={settings.ai.endpoint} onChange={(event) => onChange({ ...settings, ai: { ...settings.ai, endpoint: event.currentTarget.value } })} /></Setting>
            <Setting label={messages.aiModel}><input aria-label={messages.aiModel} type="text" value={settings.ai.model} onChange={(event) => onChange({ ...settings, ai: { ...settings.ai, model: event.currentTarget.value } })} /></Setting>
            <Setting label={messages.aiConfiguredModels}><textarea aria-label={messages.aiConfiguredModels} onChange={(event) => { const models = [...new Set(event.currentTarget.value.split(/\r?\n/gu).map((value) => value.trim()).filter(Boolean))].slice(0, 32); onChange({ ...settings, ai: { ...settings.ai, models } }); }} value={settings.ai.models.join("\n")} /></Setting>
            <AiProviderConfigurations configurations={settings.ai.configurations} onChange={(configurations) => onChange({ ...settings, ai: { ...settings.ai, configurations } })} onMutationEnd={() => setProfileSecretMutations((count) => Math.max(0, count - 1))} onMutationStart={() => setProfileSecretMutations((count) => count + 1)} persistWebSecret={settings.ai.persistWebSecret} secretStore={secretStore} />
            {mcpAvailable && mcpPermissions && onMcpEnabledChange && onMcpPermissionChange && <McpPermissionSettings enabled={mcpEnabled} permissions={mcpPermissions} onEnabledChange={onMcpEnabledChange} onPermissionChange={onMcpPermissionChange} />}
            <Setting label={messages.aiApiKey}><input aria-label={messages.aiApiKey} autoComplete="off" disabled={aiSecret.locked || aiSecret.busy} onChange={(event) => aiSecret.change(event.currentTarget.value)} type="password" value={aiSecret.secret} /></Setting>
            <div className="settings-secret-actions"><button disabled={aiSecret.locked || aiSecret.busy} onClick={aiSecret.save} type="button">{messages.saveAiKey}</button><button disabled={aiSecret.locked || aiSecret.busy || aiSecret.secret.length === 0} onClick={aiSecret.clear} type="button">{messages.clearAiKey}</button></div>
            {secretStore.persistence === "web-session" ? <>
              <Setting label={messages.persistWebSecret}><input checked={settings.ai.persistWebSecret} disabled={aiSecret.locked || aiSecret.busy} onChange={(event) => aiSecret.changePersistence(event.currentTarget.checked)} type="checkbox" /></Setting>
              <p role="note">{messages.persistWebSecretWarning}</p>
            </> : <p role="note">{messages.desktopKeychainNote}</p>}
            {aiSecret.status === "loading" && <p role="status">{messages.aiKeyLoading}</p>}
            {aiSecret.status === "saved" && <p role="status">{messages.aiKeySaved}</p>}
            {aiSecret.status === "migrated" && <p role="status">{messages.aiKeyStorageChanged}</p>}
            {aiSecret.status === "cleared" && <p role="status">{messages.aiKeyCleared}</p>}
            {(aiSecret.status === "error" || aiSecret.status === "load-error") && <p role="alert">{messages.aiKeyStorageFailed}</p>}
            {aiSecret.status === "settings-error" && !persistenceError && (
              <p role="alert">{messages.settingsSaveFailed}</p>
            )}
            {aiSecret.status === "rollback-error" && <p role="alert">{messages.aiSecretRollbackFailed}</p>}
          </Section>
        )}
        {show("keybindings") && (
          <Section section="keybindings" onRestore={restoreSection}>
            <KeybindingSettingsFields
              settings={settings.keybindings}
              onChange={changeKeybinding}
            />
            {keybindingError && <p role="alert">{keybindingError}</p>}
          </Section>
        )}
        {show("privacy") && (
          <Section section="privacy" onRestore={restoreSection}>
            <Setting label={messages.updateChecks}><input checked={settings.privacy.updateChecks} onChange={(event) => onChange({ ...settings, privacy: { updateChecks: event.currentTarget.checked } })} type="checkbox" /></Setting>
          </Section>
        )}
      </fieldset>
    </div>
    </div>
  );
}
