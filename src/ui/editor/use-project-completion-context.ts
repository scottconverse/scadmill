import { useMemo } from "react";

import { activeDocument, type DocumentWorkspaceState } from "../../application/documents/document-workspace";
import type { ProjectSessionState } from "../../application/files/project-session";
import { createRuntimeTextFileLookup } from "../../application/runtime/project-render-files";
import type { OpenScadProjectCompletionContext } from "./openscad-completion";

export function useProjectCompletionContext(
  project: ProjectSessionState,
  workspace: DocumentWorkspaceState,
): OpenScadProjectCompletionContext | undefined {
  const active = activeDocument(workspace);
  const sources = useMemo(
    () => createRuntimeTextFileLookup(project.snapshot),
    [project.snapshot],
  );
  sources.update(workspace);
  const dependencyRevision = JSON.stringify(workspace.documents
    .filter(({ id }) => id !== active.id)
    .map(({ id, path, revision }) => [id, path, revision]));
  return useMemo(
    () => project.mode === "project"
      ? {
          documentPath: active.path,
          revision: dependencyRevision,
          sources,
        }
      : undefined,
    [active.path, dependencyRevision, project.mode, sources],
  );
}
