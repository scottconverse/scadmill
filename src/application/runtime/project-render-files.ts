import type { DocumentWorkspaceState } from "../documents/document-workspace";
import type { ProjectSessionState } from "../files/project-session";
import {
  buildRenderFileMap,
  createProjectSnapshot,
  type ProjectFileContent,
} from "../files/project-snapshot";

export function buildRuntimeRenderFileMap(
  project: ProjectSessionState,
  workspace: DocumentWorkspaceState,
): ReadonlyMap<string, ProjectFileContent> {
  const baseFiles = new Map<string, ProjectFileContent>(project.snapshot.files);
  for (const document of workspace.documents) {
    if (!baseFiles.has(document.path)) baseFiles.set(document.path, document.savedSource);
  }
  return buildRenderFileMap(
    createProjectSnapshot(project.snapshot.projectId, baseFiles),
    workspace.documents.map(({ id, path, source }) => ({ documentId: id, path, source })),
  );
}

export function buildRuntimeTextFileMap(
  project: ProjectSessionState,
  workspace: DocumentWorkspaceState,
): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const [path, content] of project.snapshot.files) {
    if (typeof content === "string") sources.set(path, content);
  }
  for (const document of workspace.documents) {
    sources.set(document.path, document.source);
  }
  return sources;
}
