import type { RefObject } from "react";

import type { ProjectSnapshot } from "../../application/files/project-snapshot";
import { messages } from "../../messages/en";

export interface PendingProject {
  readonly snapshot: ProjectSnapshot;
  readonly displayName: string;
  readonly entries: readonly string[];
}

interface ProjectReplacementDialogProps {
  readonly busy: boolean;
  readonly cancelButtonRef: RefObject<HTMLButtonElement | null>;
  readonly entryFile: string;
  readonly firstFilePath: string;
  readonly hasDirtyDocuments: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly onEntryFileChange: (value: string) => void;
  readonly onFirstFilePathChange: (value: string) => void;
  readonly onSaveAll?: () => void;
  readonly pendingProject: PendingProject;
  readonly saveAllDisabled: boolean;
  readonly saveAllUnavailableReason?: string;
  readonly transitionsBlocked: boolean;
}

export function ProjectReplacementDialog({
  busy,
  cancelButtonRef,
  entryFile,
  firstFilePath,
  hasDirtyDocuments,
  onCancel,
  onConfirm,
  onEntryFileChange,
  onFirstFilePathChange,
  onSaveAll,
  pendingProject,
  saveAllDisabled,
  saveAllUnavailableReason,
  transitionsBlocked,
}: ProjectReplacementDialogProps) {
  return (
    <div aria-label={messages.confirmProjectReplacement} className="project-replacement-dialog" role="dialog">
      <h2>{messages.openRequestedProject(entryFile || pendingProject.displayName)}</h2>
      <p>{messages.projectReplacementWarning}</p>
      {hasDirtyDocuments && <p>{messages.projectReplacementBlockedDirty}</p>}
      {pendingProject.entries.length > 0
        ? (
            <label>
              <span>{messages.projectEntryFile}</span>
              <select
                aria-label={messages.projectEntryFile}
                onChange={(event) => onEntryFileChange(event.currentTarget.value)}
                value={entryFile}
              >
                {pendingProject.entries.map((path) => <option key={path}>{path}</option>)}
              </select>
            </label>
          )
        : (
            <label>
              <span>{messages.firstProjectSourceFile}</span>
              <input
                aria-label={messages.firstProjectSourceFile}
                onChange={(event) => onFirstFilePathChange(event.currentTarget.value)}
                value={firstFilePath}
              />
            </label>
          )}
      <button
        disabled={busy || transitionsBlocked || hasDirtyDocuments}
        onClick={onConfirm}
        type="button"
      >
        {messages.confirmProjectReplacement}
      </button>
      {hasDirtyDocuments && onSaveAll && (
        <button
          disabled={busy || transitionsBlocked || saveAllDisabled}
          onClick={onSaveAll}
          title={saveAllUnavailableReason}
          type="button"
        >{messages.saveAllUnsavedTabs}</button>
      )}
      <button onClick={onCancel} ref={cancelButtonRef} type="button">
        {messages.cancelProjectReplacement}
      </button>
    </div>
  );
}
