import { useEffect } from "react";

import type { DocumentWorkspaceState } from "../../application/documents/document-workspace";

export interface DocumentKeybindingOptions {
  workspace: DocumentWorkspaceState;
  onActivate(documentId: string): void;
  onClose(documentId: string): void;
  onReopen(): void;
}

export function useDocumentKeybindings({
  workspace,
  onActivate,
  onClose,
  onReopen,
}: DocumentKeybindingOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Tab") {
        event.preventDefault();
        const activeIndex = workspace.documents.findIndex(
          ({ id }) => id === workspace.activeDocumentId,
        );
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex = (
          activeIndex + offset + workspace.documents.length
        ) % workspace.documents.length;
        onActivate(workspace.documents[nextIndex].id);
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!event.shiftKey && key === "w") {
        event.preventDefault();
        onClose(workspace.activeDocumentId);
      } else if (event.shiftKey && key === "t") {
        event.preventDefault();
        onReopen();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [onActivate, onClose, onReopen, workspace]);
}
