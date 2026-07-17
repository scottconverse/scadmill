import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  matchesKeybinding,
  primaryModifierForPlatform,
} from "../../application/commands/default-keybindings";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { McpServerPort } from "../../application/platform/scadmill-platform";
import type { SecretStore } from "../../application/settings/secret-store";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";
import { SettingsDialog } from "./SettingsDialog";

export interface SettingsLauncherProps {
  readonly engineLabel: string;
  readonly runtime: WorkbenchRuntime;
  readonly secretStore: SecretStore;
  readonly renderDiskCacheAvailable?: boolean;
  readonly mcpPort?: McpServerPort;
  readonly mcpEnabled?: boolean;
  readonly onMcpEnabledChange?: (enabled: boolean) => void;
}

export function SettingsLauncher({ engineLabel, runtime, secretStore, renderDiskCacheAvailable = false, mcpPort, mcpEnabled = false, onMcpEnabledChange }: SettingsLauncherProps) {
  const [open, setOpen] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | undefined>();
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const persistenceRequest = useRef(0);
  const profile = useReadonlyStore(runtime.settings, (state) => state.profile);
  const persistenceStatus = useReadonlyStore(
    runtime.settings,
    (state) => state.persistenceStatus,
  );
  const project = useReadonlyStore(runtime.project, (state) => state);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesKeybinding(event, profile.keybindings.settings, primaryModifierForPlatform())) {
        return;
      }
      event.preventDefault();
      returnFocus.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : launcher.current;
      setOpen(true);
    };
    globalThis.addEventListener?.("keydown", handleKeyDown);
    return () => globalThis.removeEventListener?.("keydown", handleKeyDown);
  }, [profile.keybindings.settings]);
  useEffect(() => {
    if (!open) return;
    const workbench = launcher.current?.closest<HTMLElement>(".workbench");
    if (!workbench) return;
    workbench.inert = true;
    return () => { workbench.inert = false; };
  }, [open]);
  const persist = async (command: Parameters<WorkbenchRuntime["dispatch"]>[0]) => {
    const requestId = ++persistenceRequest.current;
    setPersistenceError(undefined);
    try {
      await runtime.dispatch(command);
    } catch (error) {
      if (requestId === persistenceRequest.current) {
        setPersistenceError(messages.settingsSaveFailed);
      }
      throw error;
    }
  };

  return (
    <>
      <button
        aria-label={messages.openSettings}
        className="settings-launcher"
        onClick={() => { returnFocus.current = launcher.current; setOpen(true); }}
        ref={launcher}
        type="button"
      >{messages.settingsTitle}</button>
      {open && createPortal(
        <SettingsDialog
          engineLabel={engineLabel}
          persistenceError={persistenceStatus.status === "load-error"
            ? messages.settingsLoadFailed
            : persistenceError}
          settingsMutationsBlocked={persistenceStatus.status === "load-error"}
          renderDiskCacheAvailable={renderDiskCacheAvailable}
          projectDiskRenderCacheEligible={project.mode === "project"}
          projectDiskRenderCacheEnabled={project.diskRenderCacheEnabled}
          mcpAvailable={Boolean(mcpPort)}
          mcpEnabled={mcpEnabled}
          onMcpEnabledChange={onMcpEnabledChange}
          secretStore={secretStore}
          settings={profile}
          onChange={(settings) => {
            void persist({ kind: "replace-settings", origin: "user", settings }).catch(() => undefined);
          }}
          onCommit={(update) => {
            const current = runtime.settings.getState().profile;
            const settings = update(current);
            return settings === current
              ? Promise.resolve()
              : persist({ kind: "replace-settings", origin: "user", settings });
          }}
          onProjectDiskRenderCacheChange={(enabled) => persist({
            kind: "set-project-disk-render-cache",
            origin: "user",
            enabled,
          })}
          onClearProjectDiskRenderCache={() => persist({
            kind: "clear-project-disk-render-cache",
            origin: "user",
          })}
          onClose={() => {
            setOpen(false);
            globalThis.setTimeout(() => returnFocus.current?.focus(), 0);
          }}
          onRestore={(section) =>
            persist({
              kind: "restore-settings-section",
              origin: "user",
              section,
            })}
        />,
        document.body,
      )}
    </>
  );
}
