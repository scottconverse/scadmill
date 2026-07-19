import type { DocumentWorkspaceState } from "../documents/document-workspace";
import type { ProjectStorage } from "../files/project-file-service";
import { parseProjectPath } from "../files/project-path";
import type { ProjectCommand, ProjectSessionState } from "../files/project-session";
import type { ProjectFileContent } from "../files/project-snapshot";

export interface ProjectFileHistoryStep {
  undo(): Promise<void>;
  redo(): Promise<void>;
}

function owned(content: ProjectFileContent): ProjectFileContent {
  return typeof content === "string" ? content : content.slice();
}

function destinationForRename(path: string, newName: string): string {
  const source = parseProjectPath(path);
  const separator = source.lastIndexOf("/");
  return parseProjectPath(separator < 0 ? newName : `${source.slice(0, separator)}/${newName}`);
}

export function projectFileHistoryStep(
  command: ProjectCommand,
  beforeProject: ProjectSessionState,
  beforeWorkspace: DocumentWorkspaceState,
  storage: ProjectStorage | undefined,
): ProjectFileHistoryStep | undefined {
  if (!storage) return undefined;
  const projectId = beforeProject.snapshot.projectId;
  const restoreContent = async (path: string, previous: ProjectFileContent | undefined) => {
    if (previous === undefined) await storage.trash(projectId, path);
    else await storage.write(projectId, path, owned(previous));
  };

  switch (command.kind) {
    case "save-document": {
      const document = beforeWorkspace.documents.find(({ id }) => id === command.documentId);
      if (!document) return undefined;
      const previous = beforeProject.snapshot.files.get(parseProjectPath(document.path));
      return {
        undo: () => restoreContent(document.path, previous),
        redo: () => storage.write(projectId, document.path, document.source),
      };
    }
    case "save-document-as-confirmed": {
      const document = beforeWorkspace.documents.find(({ id }) => id === command.documentId);
      if (!document) return undefined;
      const destination = parseProjectPath(command.path);
      const previous = beforeProject.snapshot.files.get(destination);
      return {
        undo: () => restoreContent(destination, previous),
        redo: () => storage.write(projectId, destination, document.source),
      };
    }
    case "create-project-file": {
      const destination = parseProjectPath(command.path);
      const content = command.source ?? "";
      return {
        undo: () => storage.trash(projectId, destination),
        redo: () => storage.write(projectId, destination, content),
      };
    }
    case "rename-project-file": {
      const source = parseProjectPath(command.path);
      const destination = destinationForRename(source, command.newName);
      return {
        undo: () => storage.move(projectId, destination, source),
        redo: () => storage.move(projectId, source, destination),
      };
    }
    case "move-project-file": {
      const source = parseProjectPath(command.path);
      const destination = parseProjectPath(command.destinationPath);
      return {
        undo: () => storage.move(projectId, destination, source),
        redo: () => storage.move(projectId, source, destination),
      };
    }
    case "delete-project-file": {
      const source = parseProjectPath(command.path);
      const previous = beforeProject.snapshot.files.get(source);
      if (previous === undefined) return undefined;
      return {
        undo: () => storage.write(projectId, source, owned(previous)),
        redo: () => storage.trash(projectId, source),
      };
    }
    default:
      return undefined;
  }
}
