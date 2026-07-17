import { type FormEvent, useState } from "react";

import type {
  ProjectDirectoryPicker,
  ProjectLocation,
  WorkspaceDirectory,
} from "../../application/files/workspace-directory";
import { messages } from "../../messages/en";

export interface ProjectOnboardingControlsProps {
  readonly busy: boolean;
  readonly directoryPicker?: ProjectDirectoryPicker;
  readonly hasDirtyDocuments: boolean;
  readonly transitionsBlocked: boolean;
  readonly workspaceDirectory?: WorkspaceDirectory;
  inspectProject(projectId: string, displayName?: string): Promise<unknown>;
  run(operation: () => Promise<unknown>): Promise<boolean>;
}

export function ProjectOnboardingControls({
  busy,
  directoryPicker,
  hasDirtyDocuments,
  inspectProject,
  run,
  transitionsBlocked,
  workspaceDirectory,
}: ProjectOnboardingControlsProps) {
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [existingVisible, setExistingVisible] = useState(false);
  const [existingWorkspaces, setExistingWorkspaces] = useState<readonly ProjectLocation[]>([]);
  const chooseProjectDirectory = () => {
    if (!directoryPicker || transitionsBlocked) return;
    void run(async () => {
      const selected = await directoryPicker.chooseDirectory();
      if (selected) await inspectProject(selected.projectId, selected.displayName);
    });
  };
  const showExistingWorkspaces = () => {
    if (!workspaceDirectory || transitionsBlocked) return;
    void run(async () => {
      setExistingWorkspaces(await workspaceDirectory.listWorkspaces());
      setExistingVisible(true);
    });
  };
  const createWorkspace = (event: FormEvent) => {
    event.preventDefault();
    const displayName = workspaceName.trim();
    if (!workspaceDirectory || transitionsBlocked || hasDirtyDocuments || !displayName) return;
    void run(async () => {
      const created = await workspaceDirectory.createWorkspace(displayName);
      await inspectProject(created.projectId, created.displayName);
      setCreatingWorkspace(false);
      setWorkspaceName("");
    });
  };
  return (
    <>
      {directoryPicker && (
        <div className="project-onboarding-actions">
          <button disabled={busy || transitionsBlocked} onClick={chooseProjectDirectory} type="button">
            {messages.chooseProjectFolder}
          </button>
        </div>
      )}
      {workspaceDirectory && (
        <div className="project-onboarding">
          <div className="project-onboarding-actions">
            <button disabled={busy || transitionsBlocked} onClick={() => setCreatingWorkspace(
              (visible) => !visible,
            )} type="button">{messages.createWorkspace}</button>
            <button disabled={busy || transitionsBlocked} onClick={showExistingWorkspaces} type="button">
              {messages.openWorkspace}
            </button>
          </div>
          {creatingWorkspace && (
            <form className="project-locator-form" onSubmit={createWorkspace}>
              <label className="project-locator">
                <span>{messages.workspaceName}</span>
                <input
                  aria-label={messages.workspaceName}
                  disabled={busy || transitionsBlocked || hasDirtyDocuments}
                  onChange={(event) => setWorkspaceName(event.currentTarget.value)}
                  value={workspaceName}
                />
              </label>
              {hasDirtyDocuments && <p>{messages.projectReplacementBlockedDirty}</p>}
              <button disabled={busy || transitionsBlocked || hasDirtyDocuments
                || !workspaceName.trim()} type="submit">{messages.createAndOpenWorkspace}</button>
            </form>
          )}
          {existingVisible && (
            <section aria-label={messages.existingWorkspaces}>
              <h3>{messages.existingWorkspaces}</h3>
              {existingWorkspaces.length === 0
                ? <p>{messages.noExistingWorkspaces}</p>
                : <ul>{existingWorkspaces.map((existing) => (
                    <li key={existing.projectId}>
                      <button
                        aria-label={messages.openNamedWorkspace(existing.displayName)}
                        disabled={busy || transitionsBlocked}
                        onClick={() => void run(() => inspectProject(
                          existing.projectId,
                          existing.displayName,
                        ))}
                        type="button"
                      >{existing.displayName}</button>
                    </li>
                  ))}</ul>}
            </section>
          )}
        </div>
      )}
    </>
  );
}
