import { useEffect, useMemo, useRef } from "react";

import {
  canCloseDocument,
  isDocumentDirty,
  type DocumentBuffer,
  type DocumentWorkspaceState,
} from "../../application/documents/document-workspace";
import { messages } from "../../messages/en";

export interface DocumentTabBarProps {
  workspace: DocumentWorkspaceState;
  onActivate(documentId: string): void;
  onClose(documentId: string): void;
  onMove(documentId: string, toIndex: number): void;
}

interface TabDescriptor {
  accessibleLabel: string;
  closable: boolean;
  closeLabel: string;
  dirty: boolean;
  document: DocumentBuffer;
  filename: string;
}

export function documentTabId(documentId: string): string {
  return `document-tab-${encodeURIComponent(documentId)}`;
}

function filename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function describeTabs(workspace: DocumentWorkspaceState): readonly TabDescriptor[] {
  const basenameCounts = new Map<string, number>();
  for (const document of workspace.documents) {
    const name = filename(document.path);
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
  }

  return workspace.documents.map((document) => {
    const name = filename(document.path);
    const accessibleLabel = basenameCounts.get(name) === 1 ? name : document.path;
    const dirty = isDocumentDirty(document);
    const closable = canCloseDocument(workspace, document.id);
    const closeLabel = dirty
      ? messages.closeDirtyDocument(accessibleLabel)
      : workspace.documents.length === 1
        ? messages.closeFinalDocument(accessibleLabel)
        : messages.closeDocument(accessibleLabel);
    return {
      accessibleLabel,
      closable,
      closeLabel,
      dirty,
      document,
      filename: name,
    };
  });
}

export function DocumentTabBar({
  workspace,
  onActivate,
  onClose,
  onMove,
}: DocumentTabBarProps) {
  const tabs = useMemo(() => describeTabs(workspace), [workspace]);
  const tabElements = useRef(new Map<string, HTMLButtonElement>());
  const draggedDocumentId = useRef<string | null>(null);
  const previousDocumentIds = useRef(workspace.documents.map(({ id }) => id));

  useEffect(() => {
    const currentIds = workspace.documents.map(({ id }) => id);
    const currentIdSet = new Set(currentIds);
    const removed = previousDocumentIds.current.some((id) => !currentIdSet.has(id));
    previousDocumentIds.current = currentIds;
    const focused = globalThis.document?.activeElement;
    if (removed && (!focused || focused === globalThis.document.body || !focused.isConnected)) {
      tabElements.current.get(workspace.activeDocumentId)?.focus();
    }
  }, [workspace.activeDocumentId, workspace.documents]);

  const activateAt = (index: number) => {
    const target = workspace.documents[index];
    if (!target) return;
    onActivate(target.id);
    tabElements.current.get(target.id)?.focus();
  };

  return (
    <div aria-label={messages.openDocuments} className="document-tabs" role="tablist">
      {tabs.map((tab, index) => {
        const { document } = tab;
        const active = document.id === workspace.activeDocumentId;
        return (
          <div className="document-tab-shell" key={document.id} role="presentation">
            <button
              aria-controls="active-document-editor"
              aria-label={tab.dirty
                ? messages.documentTabUnsaved(tab.accessibleLabel)
                : tab.accessibleLabel}
              aria-selected={active}
              className="document-tab"
              data-document-id={document.id}
              draggable
              id={documentTabId(document.id)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                if (tab.closable) onClose(document.id);
              }}
              onClick={() => onActivate(document.id)}
              onDragEnd={() => {
                draggedDocumentId.current = null;
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
              }}
              onDragStart={(event) => {
                draggedDocumentId.current = document.id;
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", document.id);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const dragged = draggedDocumentId.current
                  ?? event.dataTransfer?.getData("text/plain")
                  ?? null;
                draggedDocumentId.current = null;
                if (dragged) onMove(dragged, index);
              }}
              onKeyDown={(event) => {
                if (
                  event.altKey
                  && event.shiftKey
                  && (event.key === "ArrowLeft" || event.key === "ArrowRight")
                ) {
                  event.preventDefault();
                  const offset = event.key === "ArrowLeft" ? -1 : 1;
                  const target = Math.max(
                    0,
                    Math.min(index + offset, workspace.documents.length - 1),
                  );
                  if (target !== index) onMove(document.id, target);
                  return;
                }

                let target: number | null = null;
                if (event.key === "ArrowLeft") {
                  target = (index - 1 + workspace.documents.length) % workspace.documents.length;
                } else if (event.key === "ArrowRight") {
                  target = (index + 1) % workspace.documents.length;
                } else if (event.key === "Home") {
                  target = 0;
                } else if (event.key === "End") {
                  target = workspace.documents.length - 1;
                }
                if (target !== null) {
                  event.preventDefault();
                  activateAt(target);
                }
              }}
              ref={(node) => {
                if (node) tabElements.current.set(document.id, node);
                else tabElements.current.delete(document.id);
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <span>{tab.filename}</span>
              {tab.dirty && <span aria-hidden="true" className="dirty-marker">{"\u25cf"}</span>}
            </button>
            {tab.dirty && (
              <span className="visually-hidden" role="status">
                {messages.documentUnsavedStatus(tab.accessibleLabel)}
              </span>
            )}
            <button
              aria-label={tab.closeLabel}
              className="document-tab-close"
              disabled={!tab.closable}
              onClick={() => onClose(document.id)}
              title={tab.closeLabel}
              type="button"
            >
              <span aria-hidden="true">{"\u00d7"}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
