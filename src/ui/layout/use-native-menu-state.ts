import { useMemo } from "react";

import type { KeybindingSettings } from "../../application/commands/default-keybindings";
import {
  canCloseDocument,
  canReopenDocument,
  type DocumentWorkspaceState,
} from "../../application/documents/document-workspace";
import type { WorkspaceLayoutState } from "../../application/layout/workspace-layout";
import type { PlatformMenuState } from "../../application/platform/scadmill-platform";

interface NativeMenuStateOptions {
  readonly activeDocumentId: string;
  readonly documents: DocumentWorkspaceState;
  readonly engineAvailable: boolean;
  readonly keybindings: KeybindingSettings;
  readonly layout: WorkspaceLayoutState;
  readonly narrow: boolean;
  readonly rendering: boolean;
  readonly saveAllDisabled: boolean;
  readonly saveDisabled: boolean;
}

const NATIVE_MODIFIERS: Readonly<Record<string, string>> = {
  alt: "Alt",
  command: "Command",
  control: "Control",
  ctrl: "Control",
  meta: "Command",
  mod: "CmdOrCtrl",
  shift: "Shift",
  super: "Super",
};

const NATIVE_NAMED_KEYS = new Set([
  "backquote", "`", "backslash", "\\", "bracketleft", "[", "bracketright", "]",
  "comma", ",", "equal", "=", "minus", "-", "period", ".", "quote", "'",
  "semicolon", ";", "slash", "/", "backspace", "capslock", "enter", "space", "tab",
  "delete", "end", "home", "insert", "pagedown", "pageup", "printscreen", "scrolllock",
  "arrowdown", "down", "arrowleft", "left", "arrowright", "right", "arrowup", "up",
  "numlock", "numpadadd", "numadd", "numpadplus", "numplus", "numpaddecimal",
  "numdecimal", "numpaddivide", "numdivide", "numpadenter", "numenter", "numpadequal",
  "numequal", "numpadmultiply", "nummultiply", "numpadsubtract", "numsubtract", "escape",
  "esc", "audiovolumedown", "volumedown", "audiovolumeup", "volumeup", "audiovolumemute",
  "volumemute",
]);

function nativeKeySupported(key: string): boolean {
  const normalized = key.toLowerCase();
  return /^[a-z0-9]$/u.test(normalized)
    || /^key[a-z]$/u.test(normalized)
    || /^digit[0-9]$/u.test(normalized)
    || /^f(?:[1-9]|1[0-9]|2[0-4])$/u.test(normalized)
    || /^(?:numpad|num)[0-9]$/u.test(normalized)
    || NATIVE_NAMED_KEYS.has(normalized);
}

export function nativeAccelerator(binding: string): string | undefined {
  const parts = binding.split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key || !nativeKeySupported(key)) return undefined;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = NATIVE_MODIFIERS[part.toLowerCase()];
    if (!modifier) return undefined;
    modifiers.add(modifier);
  }
  const ordered = ["CmdOrCtrl", "Command", "Control", "Alt", "Shift", "Super"]
    .filter((modifier) => modifiers.has(modifier));
  return [...ordered, key].join("+");
}

export function withoutConflictingAccelerators(state: PlatformMenuState): PlatformMenuState {
  const counts = new Map<string, number>();
  for (const item of Object.values(state)) {
    if (!item?.accelerator) continue;
    const key = item.accelerator.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(Object.entries(state).map(([id, item]) => {
    if (!item?.accelerator || counts.get(item.accelerator.toLowerCase()) === 1) return [id, item];
    const { accelerator: _conflict, ...safeItem } = item;
    return [id, safeItem];
  })) as PlatformMenuState;
}

export function useNativeMenuState(options: NativeMenuStateOptions): PlatformMenuState {
  const closeEnabled = canCloseDocument(options.documents, options.activeDocumentId);
  const reopenEnabled = canReopenDocument(options.documents);
  return useMemo(() => withoutConflictingAccelerators({
    "file.new": { enabled: true, accelerator: nativeAccelerator(options.keybindings.newFile) },
    "file.open": { enabled: true, accelerator: nativeAccelerator(options.keybindings.openProject) },
    "file.save": { enabled: !options.saveDisabled, accelerator: nativeAccelerator(options.keybindings.saveDocument) },
    "file.save-all": { enabled: !options.saveAllDisabled, accelerator: nativeAccelerator(options.keybindings.saveAllDocuments) },
    "file.export": { enabled: options.engineAvailable, accelerator: nativeAccelerator(options.keybindings.exportModel) },
    "file.close": { enabled: closeEnabled, accelerator: nativeAccelerator(options.keybindings.closeTab) },
    "file.reopen": { enabled: reopenEnabled, accelerator: nativeAccelerator(options.keybindings.reopenClosedTab) },
    "edit.find": { enabled: true, accelerator: nativeAccelerator(options.keybindings.find) },
    "edit.replace": { enabled: true, accelerator: nativeAccelerator(options.keybindings.replace) },
    "edit.go-to-line": { enabled: true, accelerator: nativeAccelerator(options.keybindings.goToLine) },
    "edit.toggle-comment": { enabled: true, accelerator: nativeAccelerator(options.keybindings.toggleComment) },
    "edit.format-document": { enabled: true, accelerator: nativeAccelerator(options.keybindings.formatDocument) },
    "edit.format-selection": { enabled: true },
    "edit.undo": { enabled: true, accelerator: nativeAccelerator(options.keybindings.undo) },
    "edit.redo": { enabled: true, accelerator: nativeAccelerator(options.keybindings.redo) },
    "view.toggle-dock": { enabled: true, checked: options.narrow ? options.layout.narrowDockOpen : options.layout.dockOpen, accelerator: nativeAccelerator(options.keybindings.toggleDock) },
    "view.toggle-editor": { enabled: true, checked: options.narrow ? options.layout.narrowView === "code" : options.layout.editorOpen },
    "view.toggle-viewer": { enabled: true, checked: options.narrow ? options.layout.narrowView === "model" : options.layout.viewerOpen },
    "view.toggle-parameters": { enabled: true, checked: options.narrow ? options.layout.narrowSheet === "parameter" : options.layout.parameterOpen, accelerator: nativeAccelerator(options.keybindings.toggleParameters) },
    "view.toggle-console": { enabled: true, checked: options.narrow ? options.layout.narrowSheet === "console" : options.layout.consoleOpen, accelerator: nativeAccelerator(options.keybindings.toggleConsole) },
    "view.maximize-editor": { enabled: true, checked: options.layout.maximized === "editor", accelerator: nativeAccelerator(options.keybindings.maximizeEditor) },
    "view.maximize-viewer": { enabled: true, checked: options.layout.maximized === "viewer", accelerator: nativeAccelerator(options.keybindings.maximizeViewer) },
    "view.reset-layout": { enabled: true },
    "render.preview": { enabled: options.engineAvailable && !options.rendering, accelerator: nativeAccelerator(options.keybindings.renderPreview) },
    "render.full": { enabled: options.engineAvailable && !options.rendering, accelerator: nativeAccelerator(options.keybindings.renderFull) },
    "help.show": { enabled: true },
  }), [
    closeEnabled,
    options.engineAvailable,
    options.keybindings,
    options.layout,
    options.narrow,
    reopenEnabled,
    options.rendering,
    options.saveAllDisabled,
    options.saveDisabled,
  ]);
}
