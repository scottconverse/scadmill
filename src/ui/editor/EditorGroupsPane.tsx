import { type ReactNode, useEffect, useState } from "react";

import {
  createEditorGroupState,
  focusedEditorDocumentId,
  reconcileEditorGroups,
  reduceEditorGroups,
  type EditorGroupId,
} from "../../application/layout/editor-groups";
import type {
  DocumentBuffer,
  DocumentWorkspaceState,
} from "../../application/documents/document-workspace";
import { messages } from "../../messages/en";
import { DocumentTabBar, documentTabId } from "./DocumentTabBar";
import "./editor-groups.css";

export interface EditorGroupsPaneProps {
  readonly workspace: DocumentWorkspaceState;
  readonly maximized: boolean;
  readonly narrow: boolean;
  readonly renderEditor: (
    document: DocumentBuffer,
    groupId: EditorGroupId,
    focused: boolean,
  ) => ReactNode;
  readonly onActivate: (documentId: string) => void;
  readonly onClose: (documentId: string) => void;
  readonly onMoveDocument: (documentId: string, toIndex: number) => void;
  readonly onTogglePanel: () => void;
  readonly onToggleMaximize: () => void;
}

export function EditorGroupsPane({
  workspace,
  maximized,
  narrow,
  renderEditor,
  onActivate,
  onClose,
  onMoveDocument,
  onTogglePanel,
  onToggleMaximize,
}: EditorGroupsPaneProps) {
  const [state, setState] = useState(() => createEditorGroupState(
    workspace.documents.map(({ id }) => id),
    workspace.activeDocumentId,
  ));
  const renderedState = reconcileEditorGroups(
    state,
    workspace.documents.map(({ id }) => id),
    workspace.activeDocumentId,
  );
  useEffect(() => {
    setState((current) => reconcileEditorGroups(
      current,
      workspace.documents.map(({ id }) => id),
      workspace.activeDocumentId,
    ));
  }, [workspace.activeDocumentId, workspace.documents]);

  const activate = (groupId: EditorGroupId, documentId: string) => {
    setState((current) => reduceEditorGroups(current, {
      kind: "activate",
      groupId,
      documentId,
    }));
    onActivate(documentId);
  };
  const move = (groupId: EditorGroupId, documentId: string, toIndex: number) => {
    const source = renderedState.groups.find((group) => group.documentIds.includes(documentId));
    setState((current) => reduceEditorGroups(current, {
      kind: "move-document",
      documentId,
      targetGroupId: groupId,
      targetIndex: toIndex,
    }));
    if (renderedState.groups.length === 1 || source?.id === groupId) onMoveDocument(documentId, toIndex);
    onActivate(documentId);
  };
  const split = () => {
    setState(reduceEditorGroups(renderedState, {
      kind: "split",
      documentId: workspace.activeDocumentId,
    }));
  };
  const closeSplit = () => {
    const next = reduceEditorGroups(renderedState, { kind: "close-split" });
    setState(next);
    const target = focusedEditorDocumentId(next);
    if (target) onActivate(target);
  };

  return (
    <section className="editor-panel" aria-label={messages.editorRegion}>
      <div className="panel-heading editor-groups-toolbar">
        <strong>Editors</strong>
        <div className="panel-heading-actions">
          {renderedState.groups.length === 1
            ? <button aria-label="Split editor" onClick={split} type="button">Split</button>
            : <>
                <button
                  aria-label={renderedState.orientation === "horizontal" ? "Stack editors" : "Place editors side by side"}
                  onClick={() => setState((current) => reduceEditorGroups(current, {
                    kind: "set-orientation",
                    orientation: current.orientation === "horizontal" ? "vertical" : "horizontal",
                  }))}
                  type="button"
                >{renderedState.orientation === "horizontal" ? "Stack" : "Side by side"}</button>
                <button aria-label="Close split editor" onClick={closeSplit} type="button">Close split</button>
              </>}
          {!narrow && <>
            <button aria-label={messages.collapseEditor} className="panel-action" onClick={onTogglePanel} type="button"><span aria-hidden="true">−</span></button>
            <button aria-label={maximized ? messages.restoreEditor : messages.maximizeEditor} className="panel-action" onClick={onToggleMaximize} type="button"><span aria-hidden="true">{maximized ? "↙" : "↗"}</span></button>
          </>}
        </div>
      </div>
      <div className="editor-groups" data-orientation={renderedState.orientation} data-split={renderedState.groups.length === 2}>
        {renderedState.groups.map((group) => {
          const document = workspace.documents.find(({ id }) => id === group.activeDocumentId);
          const focused = group.id === renderedState.focusedGroupId;
          const editorId = `editor-group-${group.id}`;
          const tabIdPrefix = renderedState.groups.length === 2 ? `${editorId}-tab` : undefined;
          return (
            <section
              aria-label={`${group.id === "primary" ? "Primary" : "Secondary"} editor group`}
              className={`editor-group${focused ? " editor-group-focused" : ""}`}
              data-editor-group={group.id}
              key={group.id}
              onFocusCapture={() => {
                if (focused) return;
                setState((current) => reduceEditorGroups(current, { kind: "focus", groupId: group.id }));
                if (group.activeDocumentId) onActivate(group.activeDocumentId);
              }}
            >
              <DocumentTabBar
                activeDocumentId={group.activeDocumentId}
                controlsId={editorId}
                documentIds={group.documentIds}
                onActivate={(documentId) => activate(group.id, documentId)}
                onClose={onClose}
                onDropDocument={(documentId, index) => move(group.id, documentId, index)}
                onMove={onMoveDocument}
                tabIdPrefix={tabIdPrefix}
                workspace={workspace}
              />
              {document
                ? <div aria-labelledby={documentTabId(document.id, tabIdPrefix)} className="editor-document-panel" id={editorId} role="tabpanel">{renderEditor(document, group.id, focused)}</div>
                : <div className="editor-group-empty" id={editorId}>Drop a tab here</div>}
            </section>
          );
        })}
      </div>
    </section>
  );
}
