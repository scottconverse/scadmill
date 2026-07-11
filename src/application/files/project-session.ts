import type {
  DocumentWorkspaceAction,
  DocumentWorkspaceState,
} from "../documents/document-workspace";
import { createDocumentWorkspace } from "../documents/document-workspace";
import { ProjectFileService, type ProjectStorage } from "./project-file-service";
import { parseProjectPath } from "./project-path";
import { recordRecentProject, type RecentProject, validateRecentProjects } from "./recent-projects";
import { createProjectSnapshot, type ProjectFileContent, type ProjectSnapshot } from "./project-snapshot";

export interface ProjectSessionState {
  readonly mode: "scratch" | "project";
  readonly displayName: string;
  readonly snapshot: ProjectSnapshot;
  readonly revision: number;
  readonly recentProjects: readonly RecentProject[];
  readonly selectedBinaryPath?: string;
}

export type ProjectCommand =
  | { readonly kind: "new-scratch-document" }
  | { readonly kind: "replace-project-confirmed"; readonly snapshot: ProjectSnapshot; readonly displayName: string; readonly entryFile: string }
  | { readonly kind: "open-project-file"; readonly path: string }
  | { readonly kind: "save-document"; readonly documentId: string }
  | { readonly kind: "save-document-as-confirmed"; readonly documentId: string; readonly path: string }
  | { readonly kind: "create-project-file"; readonly path: string; readonly source?: string }
  | { readonly kind: "rename-project-file"; readonly path: string; readonly newName: string }
  | { readonly kind: "move-project-file"; readonly path: string; readonly destinationPath: string }
  | { readonly kind: "delete-project-file"; readonly path: string }
  | { readonly kind: "reveal-project-file"; readonly path: string }
  | { readonly kind: "refresh-project" };

const PROJECT_COMMAND_KINDS = new Set<ProjectCommand["kind"]>([
  "new-scratch-document",
  "replace-project-confirmed",
  "open-project-file",
  "save-document",
  "save-document-as-confirmed",
  "create-project-file",
  "rename-project-file",
  "move-project-file",
  "delete-project-file",
  "reveal-project-file",
  "refresh-project",
]);

export function isProjectCommand<T extends { readonly kind: string }>(
  command: T,
): command is T & ProjectCommand {
  return PROJECT_COMMAND_KINDS.has(command.kind as ProjectCommand["kind"]);
}

export interface ProjectTransition {
  readonly project: ProjectSessionState;
  readonly documentActions: readonly DocumentWorkspaceAction[];
  readonly replacementWorkspace?: DocumentWorkspaceState;
  readonly summary: string;
}

export interface ProjectCommandContext {
  readonly storage?: ProjectStorage;
  makeDocumentId(): string;
  now(): Date;
}

export function createProjectSessionState(
  snapshot: ProjectSnapshot,
  mode: ProjectSessionState["mode"] = "scratch",
  displayName = mode === "scratch" ? "Scratch" : snapshot.projectId,
  recentProjects: readonly RecentProject[] = [],
): ProjectSessionState {
  return {
    mode,
    displayName,
    snapshot,
    revision: 0,
    recentProjects: validateRecentProjects(recentProjects),
  };
}

export async function executeProjectCommand(
  state: ProjectSessionState,
  workspace: DocumentWorkspaceState,
  command: ProjectCommand,
  context: ProjectCommandContext,
): Promise<ProjectTransition | null> {
  const transition = (
    project: ProjectSessionState,
    summary: string,
    documentActions: readonly DocumentWorkspaceAction[] = [],
    replacementWorkspace?: DocumentWorkspaceState,
  ): ProjectTransition => ({
    project,
    documentActions,
    ...(replacementWorkspace ? { replacementWorkspace } : {}),
    summary,
  });
  const updatedProject = (
    snapshot: ProjectSnapshot,
    changes: Partial<ProjectSessionState> = {},
  ): ProjectSessionState => ({
    ...state,
    ...changes,
    snapshot,
    revision: state.revision + 1,
  });
  const storage = () => {
    if (!context.storage) throw new Error("Project storage is unavailable for this session.");
    return context.storage;
  };
  const service = () => new ProjectFileService(state.snapshot.projectId, storage());
  const refresh = async () => storage().snapshot(state.snapshot.projectId);
  const document = (documentId: string) => {
    const found = workspace.documents.find(({ id }) => id === documentId);
    if (!found) throw new Error(`Document ${documentId} is not open.`);
    return found;
  };
  const contentAt = (snapshot: ProjectSnapshot, path: string): ProjectFileContent => {
    const safePath = parseProjectPath(path);
    const content = snapshot.files.get(safePath);
    if (content === undefined) throw new Error(`Project file ${safePath} does not exist.`);
    return content;
  };

  switch (command.kind) {
    case "new-scratch-document": {
      if (state.mode !== "scratch") throw new Error("A scratch document can be created only in scratch mode.");
      let ordinal = 1;
      let path = "Untitled";
      while (state.snapshot.files.has(path as never)) {
        ordinal += 1;
        path = `Untitled ${ordinal}`;
      }
      const files = new Map(state.snapshot.files);
      files.set(path as never, "");
      return transition(
        updatedProject(createProjectSnapshot(state.snapshot.projectId, files)),
        `New ${path}`,
        [{ kind: "open", document: { id: context.makeDocumentId(), path, source: "" } }],
      );
    }
    case "replace-project-confirmed": {
      if (!command.displayName.trim()) throw new Error("Project display name must be non-empty.");
      const entryFile = parseProjectPath(command.entryFile);
      const source = contentAt(command.snapshot, entryFile);
      if (typeof source !== "string") throw new Error("The project entry file must be UTF-8 text.");
      const project = updatedProject(command.snapshot, {
        mode: "project",
        displayName: command.displayName,
        recentProjects: recordRecentProject(state.recentProjects, {
          projectId: command.snapshot.projectId,
          displayName: command.displayName,
          openedAt: context.now().toISOString(),
        }),
        selectedBinaryPath: undefined,
      });
      return transition(
        project,
        `Open project ${command.displayName}`,
        [],
        createDocumentWorkspace([{
          id: context.makeDocumentId(),
          path: entryFile,
          source,
        }]),
      );
    }
    case "open-project-file": {
      const path = parseProjectPath(command.path);
      const content = contentAt(state.snapshot, path);
      if (typeof content !== "string") {
        return transition({ ...state, selectedBinaryPath: path }, `Inspect binary file ${path}`);
      }
      const open = workspace.documents.find((candidate) => candidate.path === path);
      return transition(
        { ...state, selectedBinaryPath: undefined },
        `Open ${path}`,
        [open
          ? { kind: "activate", documentId: open.id }
          : {
              kind: "open",
              document: { id: context.makeDocumentId(), path, source: content },
            }],
      );
    }
    case "save-document": {
      const target = document(command.documentId);
      await storage().write(state.snapshot.projectId, target.path, target.source);
      return transition(
        updatedProject(await refresh()),
        `Save ${target.path}`,
        [{
          kind: "mark-saved",
          documentId: target.id,
          revision: target.revision,
          source: target.source,
        }],
      );
    }
    case "save-document-as-confirmed": {
      const target = document(command.documentId);
      const path = parseProjectPath(command.path);
      await storage().write(state.snapshot.projectId, path, target.source);
      return transition(
        updatedProject(await refresh()),
        `Save ${target.path} as ${path}`,
        [
          { kind: "rename-path", documentId: target.id, path },
          {
            kind: "mark-saved",
            documentId: target.id,
            revision: target.revision,
            source: target.source,
          },
        ],
      );
    }
    case "create-project-file": {
      await service().createFile(command.path, command.source ?? "");
      const snapshot = await refresh();
      const path = parseProjectPath(command.path);
      return transition(
        updatedProject(snapshot),
        `Create ${path}`,
        [{
          kind: "open",
          document: { id: context.makeDocumentId(), path, source: command.source ?? "" },
        }],
      );
    }
    case "rename-project-file": {
      await service().renameFile(command.path, command.newName);
      const source = parseProjectPath(command.path);
      const separator = source.lastIndexOf("/");
      const destination = parseProjectPath(
        separator < 0 ? command.newName : `${source.slice(0, separator)}/${command.newName}`,
      );
      const open = workspace.documents.find(({ path }) => path === source);
      return transition(
        updatedProject(await refresh()),
        `Rename ${source} to ${destination}`,
        open ? [{ kind: "rename-path", documentId: open.id, path: destination }] : [],
      );
    }
    case "move-project-file": {
      const source = parseProjectPath(command.path);
      const destination = parseProjectPath(command.destinationPath);
      await service().moveFile(source, destination);
      const open = workspace.documents.find(({ path }) => path === source);
      return transition(
        updatedProject(await refresh()),
        `Move ${source} to ${destination}`,
        open ? [{ kind: "rename-path", documentId: open.id, path: destination }] : [],
      );
    }
    case "delete-project-file": {
      const path = parseProjectPath(command.path);
      if (workspace.documents.some((candidate) => candidate.path === path)) {
        throw new Error("Close the open file before moving it to trash; close policy is unresolved.");
      }
      await service().deleteFile(path);
      return transition(updatedProject(await refresh()), `Move ${path} to trash`);
    }
    case "reveal-project-file":
      await service().revealFile(command.path);
      return transition(state, `Reveal ${command.path}`);
    case "refresh-project": {
      const snapshot = await refresh();
      return snapshot === state.snapshot
        ? null
        : transition(updatedProject(snapshot), `Refresh ${state.displayName}`);
    }
  }
}
