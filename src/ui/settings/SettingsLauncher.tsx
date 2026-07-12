import { useEffect, useRef, useState } from "react";

import {
  matchesKeybinding,
  primaryModifierForPlatform,
} from "../../application/commands/default-keybindings";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { SecretStore } from "../../application/settings/secret-store";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";
import { SettingsDialog } from "./SettingsDialog";

export interface SettingsLauncherProps {
  readonly engineLabel: string;
  readonly runtime: WorkbenchRuntime;
  readonly secretStore: SecretStore;
}

export function SettingsLauncher({ engineLabel, runtime, secretStore }: SettingsLauncherProps) {
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
      {open && (
        <SettingsDialog
          engineLabel={engineLabel}
          persistenceError={persistenceStatus.status === "load-error"
            ? messages.settingsLoadFailed
            : persistenceError}
          settingsMutationsBlocked={persistenceStatus.status === "load-error"}
          secretStore={secretStore}
          settings={profile}
          onChange={(settings) => {
            void persist({ kind: "replace-settings", origin: "user", settings }).catch(() => undefined);
          }}
          onCommit={(settings) => persist({ kind: "replace-settings", origin: "user", settings })}
          onClose={() => {
            setOpen(false);
            globalThis.setTimeout(() => returnFocus.current?.focus(), 0);
          }}
          onRestore={(section) => {
            void persist({
              kind: "restore-settings-section",
              origin: "user",
              section,
            }).catch(() => undefined);
          }}
        />
      )}
    </>
  );
}
