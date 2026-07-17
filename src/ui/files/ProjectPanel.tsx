import { type FormEvent, useEffect, useRef, useState } from "react";

import { activeDocument } from "../../application/documents/document-workspace";
import type { WorkbenchRuntime } from "../../application/runtime/workbench-runtime";
import type { ProjectStorage } from "../../application/files/project-file-service";
import type { RecoveryPersistence } from "../../application/files/recovery-state";
import type {
  ProjectDirectoryPicker,
  WorkspaceDirectory,
} from "../../application/files/workspace-directory";
import { messages } from "../../messages/en";
import { useReadonlyStore } from "../use-readonly-store";
import { ProjectLifecycleControls } from "./ProjectLifecycleControls";

export interface ProjectPanelProps {
  readonly runtime: WorkbenchRuntime;
  readonly canReveal?: boolean;
  readonly canTrash?: boolean;
  readonly storage?: ProjectStorage;
  readonly recoveryPersistence?: RecoveryPersistence;
  readonly requestedNewFile?: number;
  readonly projectTransitionsBlocked?: boolean;
  readonly directoryPicker?: ProjectDirectoryPicker;
  readonly workspaceDirectory?: WorkspaceDirectory;
}

interface TreeEntry {
  readonly kind: "directory" | "file";
  readonly name: string;
  readonly path: string;
  readonly children: readonly TreeEntry[];
}

interface MutableTreeEntry {
  kind: "directory" | "file";
  name: string;
  path: string;
  children: Map<string, MutableTreeEntry>;
}

function projectTree(paths: Iterable<string>): readonly TreeEntry[] {
  const root = new Map<string, MutableTreeEntry>();
  for (const path of paths) {
    const components = path.split("/");
    let level = root;
    for (let index = 0; index < components.length; index += 1) {
      const name = components[index];
      const entryPath = components.slice(0, index + 1).join("/");
      let entry = level.get(name);
      if (!entry) {
        entry = {
          kind: index === components.length - 1 ? "file" : "directory",
          name,
          path: entryPath,
          children: new Map(),
        };
        level.set(name, entry);
      }
      level = entry.children;
    }
  }
  const freeze = (entries: Map<string, MutableTreeEntry>): readonly TreeEntry[] =>
    [...entries.values()]
      .sort((left, right) => {
        if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
        return left.name.localeCompare(right.name);
      })
      .map((entry) => ({
        kind: entry.kind,
        name: entry.name,
        path: entry.path,
        children: freeze(entry.children),
      }));
  return freeze(root);
}

function leafName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function ProjectPanel({
  runtime,
  canReveal = false,
  canTrash = false,
  storage,
  recoveryPersistence,
  requestedNewFile,
  projectTransitionsBlocked,
  directoryPicker,
  workspaceDirectory,
}: ProjectPanelProps) {
  const project = useReadonlyStore(runtime.project, (state) => state);
  const workspace = useReadonlyStore(runtime.documents, (state) => state);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [moveValue, setMoveValue] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledNewFileRequest = useRef(requestedNewFile);
  const entries = projectTree(project.snapshot.files.keys());
  const openPaths = new Set(workspace.documents.map(({ path }) => path));
  const lifecycle = (
    <ProjectLifecycleControls
      monitor={false}
      directoryPicker={directoryPicker}
      projectLocatorKind={directoryPicker || canReveal ? "folder" : "browser"}
      projectTransitionsBlocked={projectTransitionsBlocked}
      recoveryPersistence={recoveryPersistence}
      runtime={runtime}
      storage={storage}
      workspaceDirectory={workspaceDirectory}
    />
  );
  useEffect(() => {
    if (requestedNewFile === undefined || handledNewFileRequest.current === requestedNewFile) return;
    handledNewFileRequest.current = requestedNewFile;
    setCreating(true);
  }, [requestedNewFile]);

  if (project.mode === "scratch") {
    return <section aria-label={messages.projectFiles}>{lifecycle}<p>{messages.noFolderOpen}</p></section>;
  }

  const run = async (operation: () => Promise<void>) => {
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
  };
  const createFile = (event: FormEvent) => {
    event.preventDefault();
    const path = newPath.trim();
    if (!path) return;
    void run(async () => {
      await runtime.dispatch({ kind: "create-project-file", origin: "user", path });
      setCreating(false);
      setNewPath("");
    });
  };
  const renameFile = (event: FormEvent, path: string) => {
    event.preventDefault();
    const newName = renameValue.trim();
    if (!newName) return;
    void run(async () => {
      await runtime.dispatch({
        kind: "rename-project-file",
        origin: "user",
        path,
        newName,
      });
      setRenaming(null);
      setRenameValue("");
    });
  };
  const moveFile = (event: FormEvent, path: string) => {
    event.preventDefault();
    const destinationPath = moveValue.trim();
    if (!destinationPath) return;
    void run(async () => {
      await runtime.dispatch({
        kind: "move-project-file",
        origin: "user",
        path,
        destinationPath,
      });
      setMoving(null);
      setMoveValue("");
    });
  };
  const toggleDirectory = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const renderEntries = (items: readonly TreeEntry[]) => items.map((entry) => {
    if (entry.kind === "directory") {
      const open = expanded.has(entry.path);
      return (
        <div
          aria-expanded={open}
          key={entry.path}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!dragging) return;
            const destinationPath = `${entry.path}/${leafName(dragging)}`;
            setDragging(null);
            void run(() => runtime.dispatch({
              kind: "move-project-file",
              origin: "user",
              path: dragging,
              destinationPath,
            }));
          }}
          role="treeitem"
          tabIndex={0}
        >
          <button
            aria-label={open
              ? messages.collapseProjectFolder(entry.path)
              : messages.expandProjectFolder(entry.path)}
            onClick={() => toggleDirectory(entry.path)}
            type="button"
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span> {entry.name}
          </button>
          {open && <fieldset className="project-tree-group">{renderEntries(entry.children)}</fieldset>}
        </div>
      );
    }
    const editing = renaming === entry.path;
    const movingFile = moving === entry.path;
    const open = openPaths.has(entry.path);
    return (
      <div
        draggable
        key={entry.path}
        onDragEnd={() => setDragging(null)}
        onDragStart={() => setDragging(entry.path)}
        role="treeitem"
        tabIndex={0}
      >
        {editing
          ? (
              <form onSubmit={(event) => renameFile(event, entry.path)}>
                <input
                  aria-label={messages.renameProjectFile(entry.path)}
                  onChange={(event) => setRenameValue(event.currentTarget.value)}
                  value={renameValue}
                />
                <button disabled={busy} type="submit">{messages.renameProjectFile(entry.path)}</button>
                <button onClick={() => setRenaming(null)} type="button">{messages.cancelFileAction}</button>
              </form>
            )
          : movingFile
            ? (
                <form onSubmit={(event) => moveFile(event, entry.path)}>
                  <input
                    aria-label={messages.moveProjectFileDestination(entry.path)}
                    onChange={(event) => setMoveValue(event.currentTarget.value)}
                    value={moveValue}
                  />
                  <button
                    aria-label={messages.confirmMoveProjectFile(entry.path)}
                    disabled={busy}
                    type="submit"
                  >{messages.moveProjectFile(entry.path)}</button>
                  <button onClick={() => setMoving(null)} type="button">
                    {messages.cancelFileAction}
                  </button>
                </form>
              )
            : (
              <div className="project-file-row">
                <button
                  onClick={() => void run(() => runtime.dispatch({
                    kind: "open-project-file",
                    origin: "user",
                    path: entry.path,
                  }))}
                  type="button"
                >
                  {entry.name}
                </button>
                <button
                  aria-label={messages.renameProjectFile(entry.path)}
                  disabled={busy}
                  onClick={() => {
                    setRenaming(entry.path);
                    setRenameValue(entry.name);
                  }}
                  type="button"
                >
                  ✎
                </button>
                {canTrash && (
                  <button
                    aria-label={messages.deleteProjectFile(entry.path)}
                    disabled={busy || open}
                    onClick={() => void run(() => runtime.dispatch({
                      kind: "delete-project-file",
                      origin: "user",
                      path: entry.path,
                    }))}
                    title={open ? messages.closeBeforeTrash : undefined}
                    type="button"
                  >
                    ×
                  </button>
                )}
                <button
                  aria-label={messages.moveProjectFile(entry.path)}
                  disabled={busy}
                  onClick={() => {
                    setMoving(entry.path);
                    setMoveValue(entry.path);
                  }}
                  type="button"
                >⇢</button>
                {canReveal && (
                  <button
                    aria-label={messages.revealProjectFile(entry.path)}
                    disabled={busy}
                    onClick={() => void run(() => runtime.dispatch({
                      kind: "reveal-project-file",
                      origin: "user",
                      path: entry.path,
                    }))}
                    type="button"
                  >
                    ↗
                  </button>
                )}
              </div>
            )}
      </div>
    );
  });

  return (
    <section aria-label={messages.projectFiles} className="project-panel">
      {lifecycle}
      <div className="project-panel-actions">
        <button disabled={busy} onClick={() => setCreating(true)} type="button">
          {messages.newProjectFile}
        </button>
        <button
          disabled={busy}
          onClick={() => void run(() => runtime.dispatch({
            kind: "save-document",
            origin: "user",
            documentId: activeDocument(workspace).id,
          }))}
          type="button"
        >
          {messages.saveActiveFile}
        </button>
      </div>
      {creating && (
        <form onSubmit={createFile}>
          <input
            aria-label={messages.newProjectFilePath}
            onChange={(event) => setNewPath(event.currentTarget.value)}
            value={newPath}
          />
          <button disabled={busy} type="submit">{messages.createProjectFile}</button>
          <button onClick={() => setCreating(false)} type="button">{messages.cancelFileAction}</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      <div aria-label={messages.projectFiles} role="tree">{renderEntries(entries)}</div>
      {project.selectedBinaryPath && (
        <p className="binary-file-placeholder">
          {messages.binaryFilePlaceholder(project.selectedBinaryPath)}
        </p>
      )}
    </section>
  );
}
