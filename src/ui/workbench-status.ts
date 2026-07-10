import type { RenderResult } from "../application/engine/contracts";
import type { RenderState } from "../application/runtime/workbench-runtime";
import { messages } from "../messages/en";

export function diagnosticStatusLabel(
  result: RenderResult | undefined,
  documentPath: string,
): string {
  if (!result) return messages.noCurrentDiagnosticsStatus(documentPath);
  if (result.kind === "failure" && result.reason === "cancelled") {
    return messages.renderCancelledStatus;
  }
  if (result.kind === "failure" && result.diagnostics.length === 0) {
    return messages.renderFailedDiagnosticsUnavailable;
  }
  const errors = result.diagnostics.filter(({ severity }) => severity === "error").length;
  const warnings = result.diagnostics.filter(({ severity }) => severity === "warning").length;
  return messages.diagnosticSummary(errors, warnings);
}

export function renderStatusLabel(
  render: RenderState,
  stale: boolean,
  documentPath: string,
): string {
  const path = render.entryFile ?? documentPath;
  if (render.status === "idle") return messages.renderIdle;
  if (render.status === "rendering") return messages.renderingDocument(path);
  if (render.result?.kind === "failure" && render.result.reason === "cancelled") {
    return messages.renderCancelledStatus;
  }
  const kind = render.result?.kind ?? "geometry";
  if (render.status === "success") {
    return stale
      ? messages.renderedDocumentStale(path, kind)
      : messages.renderedDocument(path, kind);
  }
  return stale
    ? messages.staleRenderFailedDocument(path)
    : messages.renderFailedDocument(path);
}
