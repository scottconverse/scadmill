import type { DocumentWorkspaceState } from "../../application/documents/document-workspace";
import type { RenderState } from "../../application/runtime/workbench-runtime";
import type { ViewerDocumentState } from "../../application/viewer/viewer-state";

export interface ActiveViewerPresentationInput {
  readonly activeDocumentId: string;
  readonly documents: DocumentWorkspaceState;
  readonly render: RenderState;
  readonly viewer: ViewerDocumentState;
}

export function resolveActiveViewerPresentation(input: ActiveViewerPresentationInput) {
  const { activeDocumentId, documents, render, viewer } = input;
  const renderedDocument = documents.documents.find(({ id }) => id === render.documentId);
  const stale = Boolean(
    render.documentId
    && (
      !renderedDocument
      || renderedDocument.revision !== render.sourceRevision
      || !render.sourceFiles
      || documents.documents.some(({ path, source }) => render.sourceFiles?.get(path) !== source)
    ),
  );
  const currentResult = stale ? undefined : render.result;
  const activeOperation = render.documentId === activeDocumentId;
  const operationResult = activeOperation ? currentResult : undefined;
  const failure = operationResult?.kind === "failure" ? operationResult : undefined;
  const result = operationResult?.kind === "3d"
    ? operationResult
    : viewer.presentation?.result;
  const status = activeOperation
    ? render.status
    : result
      ? "success" as const
      : "idle" as const;
  const quality = activeOperation ? render.quality : viewer.presentation?.quality;
  return {
    currentResult,
    dimmed: Boolean(result && (failure || stale || status === "rendering")),
    failure,
    quality,
    result,
    stale,
    status,
  };
}
