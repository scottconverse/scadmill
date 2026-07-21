import type { DocumentWorkspaceState } from "../documents/document-workspace";
import type { ProjectSessionState } from "../files/project-session";
import type { ProjectPath } from "../files/project-path";
import {
  buildRenderFileMap,
  createProjectSnapshot,
  type ProjectFileContent,
  type ProjectSnapshot,
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
    createProjectSnapshot(
      project.snapshot.projectId,
      baseFiles,
      project.snapshot.workspaceIdentity,
    ),
    workspace.documents.map(({ id, path, source }) => ({ documentId: id, path, source })),
  );
}

export interface RuntimeTextFileLookup {
  get(path: string): string | undefined;
  update(workspace: DocumentWorkspaceState): void;
}

export function createRuntimeTextFileLookup(
  snapshot: ProjectSnapshot,
): RuntimeTextFileLookup {
  let overlays = new Map<string, string>();
  const update = (next: DocumentWorkspaceState) => {
    overlays = new Map(next.documents.map(({ path, source }) => [path, source]));
  };
  return {
    get: (path) => {
      const overlay = overlays.get(path);
      if (overlay !== undefined) return overlay;
      const source = snapshot.files.get(path as ProjectPath);
      return typeof source === "string" ? source : undefined;
    },
    update,
  };
}
