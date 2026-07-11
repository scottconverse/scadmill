import { useEffect } from "react";

import type { DocumentWorkspaceState } from "../../application/documents/document-workspace";
import {
  DEFAULT_KEYBINDINGS,
  type KeybindingSettings,
  matchesKeybinding,
  primaryModifierForPlatform,
} from "../../application/commands/default-keybindings";

export interface DocumentKeybindingOptions {
  workspace: DocumentWorkspaceState;
  keybindings?: KeybindingSettings;
  onActivate(documentId: string): void;
  onClose(documentId: string): void;
  onReopen(): void;
  onSave?(): void;
  onSaveAll?(): void;
  onNewFile?(): void;
  onOpenProject?(): void;
  onExport?(): void;
}

export function useDocumentKeybindings({
  workspace,
  keybindings = DEFAULT_KEYBINDINGS,
  onActivate,
  onClose,
  onReopen,
  onSave = () => undefined,
  onSaveAll = () => undefined,
  onNewFile = () => undefined,
  onOpenProject = () => undefined,
  onExport = () => undefined,
}: DocumentKeybindingOptions): void {
  const primaryModifier = primaryModifierForPlatform();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const next = matchesKeybinding(event, keybindings.nextTab, primaryModifier);
      const previous = matchesKeybinding(event, keybindings.previousTab, primaryModifier);
      if (next || previous) {
        event.preventDefault();
        const activeIndex = workspace.documents.findIndex(
          ({ id }) => id === workspace.activeDocumentId,
        );
        const offset = previous ? -1 : 1;
        const nextIndex = (
          activeIndex + offset + workspace.documents.length
        ) % workspace.documents.length;
        onActivate(workspace.documents[nextIndex].id);
        return;
      }
      if (matchesKeybinding(event, keybindings.closeTab, primaryModifier)) {
        event.preventDefault();
        onClose(workspace.activeDocumentId);
      } else if (matchesKeybinding(event, keybindings.reopenClosedTab, primaryModifier)) {
        event.preventDefault();
        onReopen();
      } else if (matchesKeybinding(event, keybindings.saveAllDocuments, primaryModifier)) {
        event.preventDefault();
        onSaveAll();
      } else if (matchesKeybinding(event, keybindings.saveDocument, primaryModifier)) {
        event.preventDefault();
        onSave();
      } else if (matchesKeybinding(event, keybindings.newFile, primaryModifier)) {
        event.preventDefault();
        onNewFile();
      } else if (matchesKeybinding(event, keybindings.openProject, primaryModifier)) {
        event.preventDefault();
        onOpenProject();
      } else if (matchesKeybinding(event, keybindings.exportModel, primaryModifier)) {
        event.preventDefault();
        onExport();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [
    keybindings,
    onActivate,
    onClose,
    onExport,
    onNewFile,
    onOpenProject,
    onReopen,
    onSave,
    onSaveAll,
    primaryModifier,
    workspace,
  ]);
}
