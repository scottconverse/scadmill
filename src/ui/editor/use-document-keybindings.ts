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
}

export function useDocumentKeybindings({
  workspace,
  keybindings = DEFAULT_KEYBINDINGS,
  onActivate,
  onClose,
  onReopen,
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
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [keybindings, onActivate, onClose, onReopen, primaryModifier, workspace]);
}
