import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isDocumentDirty } from "../../application/documents/document-workspace";
import type { ProjectStorage } from "../../application/files/project-file-service";
import type { ProjectSnapshot } from "../../application/files/project-snapshot";
import {
  RecoveryCoordinator,
  type RecoveryPersistence,
  type RecoverySnapshot,
  recoveryDisplayName,
} from "../../application/files/recovery-state";
import type {
  ProjectDirectoryPicker,
  WorkspaceDirectory,
} from "../../application/files/workspace-directory";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";
import { ProjectExternalChangeControls } from "./ProjectExternalChangeControls";
import { ProjectOnboardingControls } from "./ProjectOnboardingControls";
import {
  type PendingProject,
  ProjectReplacementDialog,
} from "./ProjectReplacementDialog";
import { useRequestedProject } from "./use-requested-project";
const EPHEMERAL_RECOVERY: RecoveryPersistence = {
  load: () => null,
  save: () => undefined,
  clear: () => undefined,
};
const RECOVERY_CAPTURE_DELAY_MS = 300;
export interface ProjectLifecycleControlsProps {
  readonly runtime: WorkbenchRuntime;
  readonly storage?: ProjectStorage;
  readonly recoveryPersistence?: RecoveryPersistence;
  readonly pollIntervalMs?: number;
  readonly monitor?: boolean;
  readonly showOpenControls?: boolean;
  readonly requestedProject?: ProjectOpenRequest;
  readonly onRequestedProjectSettled?: (sequence: number) => void;
  readonly projectTransitionsBlocked?: boolean;
  readonly onRecoveryPendingChange?: (pending: boolean) => void;
  readonly projectLocatorKind?: "folder" | "browser" | "generic";
  readonly directoryPicker?: ProjectDirectoryPicker;
  readonly workspaceDirectory?: WorkspaceDirectory;
  readonly onSaveAll?: () => void;
  readonly saveAllDisabled?: boolean;
  readonly saveAllUnavailableReason?: string;
}
export interface ProjectOpenRequest {
  readonly sequence: number;
  readonly projectId: string;
  readonly displayName: string;
  readonly preferredEntryFile?: string;
  readonly openWhenClean?: boolean;
}
function projectDisplayName(projectId: string): string {
  return projectId.split(/[\\/]/u).filter(Boolean).at(-1) ?? projectId;
}
function scadEntries(snapshot: ProjectSnapshot): readonly string[] {
  return [...snapshot.files]
    .filter(([path, content]) => path.toLowerCase().endsWith(".scad") && typeof content === "string")
    .map(([path]) => path)
    .sort((left, right) => {
      if (left === "main.scad") return -1;
      if (right === "main.scad") return 1;
      return left.localeCompare(right);
    });
}
export function ProjectLifecycleControls({
  runtime,
  storage,
  recoveryPersistence = EPHEMERAL_RECOVERY,
  pollIntervalMs = 1_500,
  monitor = true,
  showOpenControls = true,
  requestedProject,
  onRequestedProjectSettled,
  projectTransitionsBlocked = false,
  onRecoveryPendingChange,
  projectLocatorKind = "generic",
  directoryPicker,
  workspaceDirectory,
  onSaveAll,
  saveAllDisabled = false,
  saveAllUnavailableReason,
}: ProjectLifecycleControlsProps) {
  const projectLocatorHelpId = useId();
  const project = useReadonlyStore(runtime.project, (state) => state);
  const workspace = useReadonlyStore(runtime.documents, (state) => state);
  const coordinator = useMemo(
    () => new RecoveryCoordinator(recoveryPersistence),
    [recoveryPersistence],
  );
  const [projectId, setProjectId] = useState("");
  const [pendingProject, setPendingProject] = useState<PendingProject | null>(null);
  const [entryFile, setEntryFile] = useState("");
  const [firstFilePath, setFirstFilePath] = useState("main.scad");
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(() =>
    monitor ? coordinator.load() : null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelReplacement = useRef<HTMLButtonElement>(null);
  const replacementPreviousFocus = useRef<HTMLElement | null>(null);
  const hasDirtyDocuments = workspace.documents.some(isDocumentDirty);
  const transitionsBlocked = projectTransitionsBlocked || Boolean(recovery);
  const projectLocatorLabel = projectLocatorKind === "folder"
    ? messages.projectFolderPath
    : projectLocatorKind === "browser"
      ? messages.browserProjectName
      : messages.projectFolderOrId;
  const projectLocatorHelp = projectLocatorKind === "folder"
    ? messages.projectFolderPathHelp
    : projectLocatorKind === "browser"
      ? messages.browserProjectNameHelp
      : null;
  useLayoutEffect(() => {
    if (monitor) onRecoveryPendingChange?.(Boolean(recovery));
  }, [monitor, onRecoveryPendingChange, recovery]);
  useLayoutEffect(() => {
    if (!pendingProject) return;
    if (!replacementPreviousFocus.current) {
      replacementPreviousFocus.current = globalThis.document.activeElement instanceof HTMLElement
        ? globalThis.document.activeElement
        : null;
    }
    cancelReplacement.current?.focus();
  }, [pendingProject]);
  const run = useCallback(async (operation: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await operation();
      return true;
    } catch (reason) {
      setError(reason instanceof Error
        ? messages.projectActionFailedWithDetail(reason.message)
        : messages.projectActionFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy]);
  const inspectProject = useCallback(async (
    requestedId: string,
    displayName?: string,
    preferredEntryFile?: string,
  ): Promise<PendingProject> => {
    if (transitionsBlocked) throw new Error("Project changes are blocked while recovery is pending.");
    if (!storage) throw new Error(messages.projectStorageUnavailable);
    const snapshot = await storage.snapshot(requestedId.trim(), preferredEntryFile);
    const entries = scadEntries(snapshot);
    const inspected = {
      snapshot,
      displayName: displayName ?? projectDisplayName(snapshot.projectId),
      entries,
    };
    const selectedEntry = preferredEntryFile
      ? entries.find((entry) => entry === preferredEntryFile)
      : entries[0];
    if (preferredEntryFile && !selectedEntry) {
      throw new Error(`The requested OpenSCAD entry ${preferredEntryFile} is unavailable.`);
    }
    setPendingProject(inspected);
    setEntryFile(selectedEntry ?? "");
    setFirstFilePath("main.scad");
    return inspected;
  }, [storage, transitionsBlocked]);
  useRequestedProject({
    busy, hasDirtyDocuments, inspectProject, onSettled: onRequestedProjectSettled,
    request: requestedProject, run, runtime, setPendingProject, transitionsBlocked,
  });
  useEffect(() => {
    if (!monitor || busy) return;
    if (!recovery && !workspace.documents.some(isDocumentDirty)) {
      try {
        coordinator.capture(project.snapshot.projectId, workspace, project.displayName);
      } catch (reason) {
        setError(reason instanceof Error
          ? `${messages.recoveryCouldNotBeSaved} ${reason.message}`
          : messages.recoveryCouldNotBeSaved);
      }
      return;
    }
    const capture = globalThis.setTimeout(() => {
      try {
        if (recovery) coordinator.captureAlongside(recovery, workspace);
        else coordinator.capture(project.snapshot.projectId, workspace, project.displayName);
      } catch (reason) {
        setError(reason instanceof Error
          ? `${messages.recoveryCouldNotBeSaved} ${reason.message}`
          : messages.recoveryCouldNotBeSaved);
      }
    }, RECOVERY_CAPTURE_DELAY_MS);
    return () => globalThis.clearTimeout(capture);
  }, [
    busy,
    coordinator,
    monitor,
    project.displayName,
    project.snapshot.projectId,
    recovery,
    workspace,
  ]);
  const openProject = (event: FormEvent) => {
    event.preventDefault();
    if (transitionsBlocked || !projectId.trim()) return;
    void run(() => inspectProject(projectId));
  };
  const confirmProject = () => {
    if (transitionsBlocked || !pendingProject || hasDirtyDocuments) return;
    void run(async () => {
      let snapshot = pendingProject.snapshot;
      let selectedEntry = entryFile;
      if (pendingProject.entries.length === 0) {
        selectedEntry = firstFilePath.trim();
        if (!selectedEntry.toLowerCase().endsWith(".scad")) {
          throw new Error(messages.firstProjectSourceMustBeScad);
        }
        if (!storage) throw new Error(messages.projectStorageUnavailable);
        await storage.write(snapshot.projectId, selectedEntry, "");
        snapshot = await storage.snapshot(snapshot.projectId);
      }
      await runtime.dispatch({
        kind: "replace-project-confirmed",
        origin: "user",
        snapshot,
        displayName: pendingProject.displayName,
        entryFile: selectedEntry,
      });
      replacementPreviousFocus.current = null;
      setPendingProject(null);
      setProjectId("");
      if (requestedProject) onRequestedProjectSettled?.(requestedProject.sequence);
    });
  };
  const cancelProjectReplacement = () => {
    const previousFocus = replacementPreviousFocus.current;
    replacementPreviousFocus.current = null;
    setPendingProject(null);
    if (requestedProject) onRequestedProjectSettled?.(requestedProject.sequence);
    globalThis.setTimeout(() => previousFocus?.focus(), 0);
  };

  const restoreRecovery = () => {
    if (!recovery) return;
    void run(async () => {
      let expectedProject = runtime.project.getState();
      let expectedWorkspace = runtime.documents.getState();
      let restoration = coordinator.captureAlongside(
        recovery,
        expectedWorkspace,
      );
      let snapshot: ProjectSnapshot | undefined;
      if (restoration.projectId !== "scratch") {
        if (!storage) throw new Error(messages.recoveryProjectStorageUnavailable);
        const projectBeforeSnapshot = expectedProject;
        const workspaceBeforeSnapshot = expectedWorkspace;
        snapshot = await storage.snapshot(restoration.projectId);
        expectedProject = runtime.project.getState();
        expectedWorkspace = runtime.documents.getState();
        restoration = coordinator.captureAlongside(
          restoration,
          expectedWorkspace,
        );
        if (expectedProject !== projectBeforeSnapshot) {
          throw new Error(messages.recoveryProjectStateChanged);
        }
        if (
          expectedWorkspace !== workspaceBeforeSnapshot
          && restoration.projectId !== "scratch"
        ) {
          throw new Error(messages.recoveryWorkspaceChanged);
        }
        if (restoration.projectId === "scratch") snapshot = undefined;
      }
      await runtime.dispatch({
        kind: "restore-recovery-confirmed",
        origin: "system",
        recovery: restoration,
        expectedProject,
        expectedWorkspace,
        ...(snapshot
          ? { snapshot, displayName: recoveryDisplayName(restoration.projectId, restoration.displayName) }
          : {}),
      });
      setRecovery(null);
    });
  };

  return (
    <div className="project-lifecycle-controls">
      {showOpenControls && storage && (directoryPicker || workspaceDirectory) && (
        <ProjectOnboardingControls
          busy={busy}
          directoryPicker={directoryPicker}
          hasDirtyDocuments={hasDirtyDocuments}
          inspectProject={inspectProject}
          run={run}
          transitionsBlocked={transitionsBlocked}
          workspaceDirectory={workspaceDirectory}
        />
      )}
      {showOpenControls && storage && (projectLocatorKind !== "browser" || !workspaceDirectory) && (
        <details className="project-manual-locator" open={!directoryPicker}>
          <summary>{directoryPicker ? messages.enterFolderPathInstead : messages.manualProjectEntry}</summary>
        <form className="project-locator-form" onSubmit={openProject}>
          <label className="project-locator">
            <span>{projectLocatorLabel}</span>
            <input
              aria-describedby={projectLocatorHelp ? projectLocatorHelpId : undefined}
              aria-label={projectLocatorLabel}
              disabled={busy || transitionsBlocked}
              onChange={(event) => setProjectId(event.currentTarget.value)}
              value={projectId}
            />
            {projectLocatorHelp && (
              <small className="project-locator-help" id={projectLocatorHelpId}>
                {projectLocatorHelp}
              </small>
            )}
          </label>
          <button disabled={busy || transitionsBlocked || !projectId.trim()} type="submit">
            {messages.openProject}
          </button>
        </form>
        </details>
      )}
      {pendingProject && (
        <ProjectReplacementDialog
          busy={busy}
          cancelButtonRef={cancelReplacement}
          entryFile={entryFile}
          firstFilePath={firstFilePath}
          hasDirtyDocuments={hasDirtyDocuments}
          onCancel={cancelProjectReplacement}
          onConfirm={confirmProject}
          onEntryFileChange={setEntryFile}
          onFirstFilePathChange={setFirstFilePath}
          onSaveAll={onSaveAll}
          pendingProject={pendingProject}
          saveAllDisabled={saveAllDisabled}
          saveAllUnavailableReason={saveAllUnavailableReason}
          transitionsBlocked={transitionsBlocked}
        />
      )}
      {showOpenControls && project.recentProjects.length > 0 && (
        <section aria-label={messages.recentProjects}>
          <h3>{messages.recentProjects}</h3>
          <ul>{project.recentProjects.map((recent) => (
            <li key={recent.projectId}>
              <button
                aria-label={messages.reopenProject(recent.displayName)}
                disabled={busy || transitionsBlocked || !storage}
                onClick={() => void run(() => inspectProject(recent.projectId, recent.displayName))}
                type="button"
              >{recent.displayName}</button>
            </li>
          ))}</ul>
        </section>
      )}
      {monitor && project.mode === "project" && storage?.read && (
        <ProjectExternalChangeControls
          documents={workspace.documents}
          pollIntervalMs={pollIntervalMs}
          projectId={project.snapshot.projectId}
          runtime={runtime}
          storage={storage}
        />
      )}
      {monitor && recovery && (
        <section aria-label={messages.recoveryTitle}>
          <p aria-live="polite">{messages.recoveryMessage}</p>
          <button disabled={busy} onClick={restoreRecovery} type="button">
            {messages.restoreRecovery}
          </button>
          <button
            disabled={busy}
            onClick={() => void run(async () => {
              coordinator.discard();
              setRecovery(null);
            })}
            type="button"
          >{messages.discardRecovery}</button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
