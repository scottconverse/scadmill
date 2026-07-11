import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { isDocumentDirty } from "../../application/documents/document-workspace";
import type { ProjectStorage } from "../../application/files/project-file-service";
import {
  RecoveryCoordinator,
  type RecoveryPersistence,
  type RecoverySnapshot,
} from "../../application/files/recovery-state";
import type { ProjectSnapshot } from "../../application/files/project-snapshot";
import type {
  ProjectDirectoryPicker,
  WorkspaceDirectory,
} from "../../application/files/workspace-directory";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";
import { ProjectExternalChangeControls } from "./ProjectExternalChangeControls";
import { ProjectOnboardingControls } from "./ProjectOnboardingControls";

const EPHEMERAL_RECOVERY: RecoveryPersistence = {
  load: () => null,
  save: () => undefined,
  clear: () => undefined,
};
const RECOVERY_CAPTURE_DELAY_MS = 300;

interface PendingProject {
  readonly snapshot: ProjectSnapshot;
  readonly displayName: string;
  readonly entries: readonly string[];
}

export interface ProjectLifecycleControlsProps {
  readonly runtime: WorkbenchRuntime;
  readonly storage?: ProjectStorage;
  readonly recoveryPersistence?: RecoveryPersistence;
  readonly pollIntervalMs?: number;
  readonly monitor?: boolean;
  readonly showOpenControls?: boolean;
  readonly requestedProject?: ProjectOpenRequest;
  readonly projectTransitionsBlocked?: boolean;
  readonly onRecoveryPendingChange?: (pending: boolean) => void;
  readonly projectLocatorKind?: "folder" | "browser" | "generic";
  readonly directoryPicker?: ProjectDirectoryPicker;
  readonly workspaceDirectory?: WorkspaceDirectory;
}

export interface ProjectOpenRequest {
  readonly sequence: number;
  readonly projectId: string;
  readonly displayName: string;
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
  projectTransitionsBlocked = false,
  onRecoveryPendingChange,
  projectLocatorKind = "generic",
  directoryPicker,
  workspaceDirectory,
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
  const handledRequest = useRef<number | null>(null);
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

  const run = useCallback(async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error
        ? messages.projectActionFailedWithDetail(reason.message)
        : messages.projectActionFailed);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const inspectProject = useCallback(async (requestedId: string, displayName?: string) => {
    if (transitionsBlocked) return;
    if (!storage) throw new Error(messages.projectStorageUnavailable);
    const snapshot = await storage.snapshot(requestedId.trim());
    const entries = scadEntries(snapshot);
    setPendingProject({
      snapshot,
      displayName: displayName ?? projectDisplayName(snapshot.projectId),
      entries,
    });
    setEntryFile(entries[0] ?? "");
    setFirstFilePath("main.scad");
  }, [storage, transitionsBlocked]);

  useEffect(() => {
    if (transitionsBlocked || !requestedProject || handledRequest.current === requestedProject.sequence) return;
    handledRequest.current = requestedProject.sequence;
    void run(() => inspectProject(requestedProject.projectId, requestedProject.displayName));
  }, [inspectProject, requestedProject, run, transitionsBlocked]);

  useEffect(() => {
    if (!monitor || busy) return;
    if (!recovery && !workspace.documents.some(isDocumentDirty)) {
      try {
        coordinator.capture(project.snapshot.projectId, workspace);
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
        else coordinator.capture(project.snapshot.projectId, workspace);
      } catch (reason) {
        setError(reason instanceof Error
          ? `${messages.recoveryCouldNotBeSaved} ${reason.message}`
          : messages.recoveryCouldNotBeSaved);
      }
    }, RECOVERY_CAPTURE_DELAY_MS);
    return () => globalThis.clearTimeout(capture);
  }, [busy, coordinator, monitor, project.snapshot.projectId, recovery, workspace]);

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
      setPendingProject(null);
      setProjectId("");
    });
  };

  const restoreRecovery = () => {
    if (!recovery) return;
    void run(async () => {
      const restoration = coordinator.captureAlongside(
        recovery,
        runtime.documents.getState(),
      );
      if (restoration.projectId !== "scratch") {
        if (!storage) throw new Error(messages.recoveryProjectStorageUnavailable);
        const snapshot = await storage.snapshot(restoration.projectId);
        const entry = restoration.buffers.find(({ path }) =>
          path.toLowerCase().endsWith(".scad") && typeof snapshot.files.get(path as never) === "string"
        )?.path ?? scadEntries(snapshot)[0];
        if (!entry) throw new Error(messages.projectRequiresScadEntry);
        await runtime.dispatch({
          kind: "replace-project-confirmed",
          origin: "system",
          snapshot,
          displayName: projectDisplayName(snapshot.projectId),
          entryFile: entry,
        });
      }
      for (const buffer of restoration.buffers) {
        let target = runtime.documents.getState().documents.find(({ path }) => path === buffer.path);
        if (!target && restoration.projectId === "scratch") {
          const usedIds = new Set(runtime.documents.getState().documents.map(({ id }) => id));
          const documentId = usedIds.has(buffer.documentId)
            ? `recovery-${usedIds.size}-${buffer.documentId}`
            : buffer.documentId;
          await runtime.dispatch({
            kind: "open-document",
            origin: "system",
            document: { id: documentId, path: buffer.path, source: buffer.savedSource },
          });
          target = runtime.documents.getState().documents.find(({ path }) => path === buffer.path);
        } else if (!target) {
          await runtime.dispatch({ kind: "open-project-file", origin: "system", path: buffer.path });
          target = runtime.documents.getState().documents.find(({ path }) => path === buffer.path);
        }
        if (!target) continue;
        await runtime.dispatch({
          kind: "resolve-external-change",
          origin: "system",
          documentId: target.id,
          diskSource: buffer.savedSource,
          choice: "reload",
        });
        await runtime.dispatch({
          kind: "edit-document",
          origin: "system",
          documentId: target.id,
          source: buffer.source,
        });
      }
      coordinator.discard();
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
        <div aria-label={messages.confirmProjectReplacement} role="dialog">
          <p>{messages.projectReplacementWarning}</p>
          {hasDirtyDocuments && <p>{messages.unsavedChanges}</p>}
          {pendingProject.entries.length > 0
            ? (
                <label>
                  <span>{messages.projectEntryFile}</span>
                  <select
                    aria-label={messages.projectEntryFile}
                    onChange={(event) => setEntryFile(event.currentTarget.value)}
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
                    onChange={(event) => setFirstFilePath(event.currentTarget.value)}
                    value={firstFilePath}
                  />
                </label>
              )}
          <button
            disabled={busy || transitionsBlocked || hasDirtyDocuments}
            onClick={confirmProject}
            type="button"
          >
            {messages.confirmProjectReplacement}
          </button>
          <button onClick={() => setPendingProject(null)} type="button">
            {messages.cancelProjectReplacement}
          </button>
        </div>
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
        <div aria-label={messages.recoveryTitle} role="alertdialog">
          <p>{messages.recoveryMessage}</p>
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
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
