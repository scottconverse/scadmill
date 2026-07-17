import type { RenderResult } from "../application/engine/contracts";
import type { GeometryDelta } from "../application/geometry/geometry-delta";
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
    if (render.cached) {
      return stale
        ? messages.renderedDocumentCachedStale(path, kind)
        : messages.renderedDocumentCached(path, kind);
    }
    return stale
      ? messages.renderedDocumentStale(path, kind)
      : messages.renderedDocument(path, kind);
  }
  return stale
    ? messages.staleRenderFailedDocument(path)
    : messages.renderFailedDocument(path);
}

function signedDelta(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.001) return `${value > 0 ? "+" : "-"}<0.001`;
  const rounded = Number(value.toFixed(3));
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function vectorDelta(values: readonly number[]): string {
  return values.map(signedDelta).join("/");
}

function geometryMetricLabels(delta: Extract<GeometryDelta, { kind: "changed" }>) {
  const volume = delta.dimensions === 2
    ? messages.geometryMetricNotApplicable
    : delta.volumeMm3 === undefined
      ? messages.geometryMetricUnavailable
      : `${signedDelta(delta.volumeMm3)} mm³`;
  const bounds = delta.boundingBox
    ? `min ${vectorDelta(delta.boundingBox.min)} mm, max ${vectorDelta(delta.boundingBox.max)} mm, size ${vectorDelta(delta.boundingBox.size)} mm`
    : messages.geometryMetricUnavailable;
  const triangles = delta.dimensions === 2
    ? messages.geometryMetricNotApplicable
    : delta.triangles === undefined
      ? messages.geometryMetricUnavailable
      : signedDelta(delta.triangles);
  return { bounds, triangles, volume };
}

export function geometryDeltaStatusLabel(delta: GeometryDelta | undefined): string | null {
  if (!delta) return null;
  if (delta.kind === "baseline") return messages.geometryBaseline;
  if (delta.kind === "unchanged") return messages.geometryUnchanged;
  if (delta.kind === "unavailable") return messages.geometryComparisonUnavailable;
  if (delta.dimensions === "incomparable") return messages.geometryMetricsIncomparable;
  const { bounds, triangles, volume } = geometryMetricLabels(delta);
  return messages.geometryChangedWithDeltas(volume, bounds, triangles);
}

export function geometryDeltaStatusSummary(delta: GeometryDelta | undefined): string | null {
  const detail = geometryDeltaStatusLabel(delta);
  if (delta?.kind !== "changed" || delta.dimensions === "incomparable") return detail;
  const { triangles, volume } = geometryMetricLabels(delta);
  const bounds = delta.boundingBox
    ? `${vectorDelta(delta.boundingBox.size)} mm size`
    : messages.geometryMetricUnavailable;
  return messages.geometryChangedSummary(volume, bounds, triangles);
}

export function geometryDeltaStatus(delta: GeometryDelta | undefined) {
  const detail = geometryDeltaStatusLabel(delta);
  const summary = geometryDeltaStatusSummary(delta);
  return detail && summary ? { detail, summary } : null;
}
