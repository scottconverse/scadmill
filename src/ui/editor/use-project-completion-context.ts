import { useMemo } from "react";

import { activeDocument, type DocumentWorkspaceState } from "../../application/documents/document-workspace";
import type { ProjectSessionState } from "../../application/files/project-session";
import { buildRuntimeTextFileMap } from "../../application/runtime/project-render-files";
import type { OpenScadProjectCompletionContext } from "./openscad-completion";

export function useProjectCompletionContext(
  project: ProjectSessionState,
  workspace: DocumentWorkspaceState,
): OpenScadProjectCompletionContext | undefined {
  return useMemo(
    () => project.mode === "project"
      ? {
          documentPath: activeDocument(workspace).path,
          sources: buildRuntimeTextFileMap(project, workspace),
        }
      : undefined,
    [project, workspace],
  );
}
