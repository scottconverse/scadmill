import { describe, expect, it } from "vitest";
import {
  createViewerState,
  reduceViewerState,
  viewerDocument,
} from "../../../src/application/viewer/viewer-state";
import type { RenderSuccess3D } from "../../../src/application/engine/contracts";

const cubeResult: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { boundingBox: { min: [0, 0, 0], max: [10, 10, 10] }, engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "",
};

describe("per-document viewer state", () => {
  it("preserves bit-identical camera state across same-document model changes", () => {
    let state = createViewerState();
    const camera = {
      projection: "perspective" as const,
      position: [23.5, -4, 71] as [number, number, number],
      target: [5, 5, 5] as [number, number, number],
      up: [0, 0, 1] as [number, number, number],
      zoom: 1.25,
    };
    state = reduceViewerState(state, { kind: "set-camera", documentId: "doc-a", camera });
    const before = viewerDocument(state, "doc-a").camera;
    state = reduceViewerState(state, {
      kind: "model-changed",
      documentId: "doc-a",
      modelIdentity: "render-2",
    });

    expect(viewerDocument(state, "doc-a").camera).toEqual(before);
    expect(viewerDocument(state, "doc-a").camera).not.toBe(before);
  });

  it("isolates camera, measurements, and annotations by document", () => {
    let state = createViewerState();
    state = reduceViewerState(state, {
      kind: "add-annotation",
      documentId: "doc-a",
      annotation: { id: "note-1", point: [1, 2, 3], text: "Hole center" },
    });
    state = reduceViewerState(state, {
      kind: "add-point-measurement",
      documentId: "doc-a",
      measurement: { id: "m-1", start: [0, 0, 0], end: [1, 1, 1] },
    });
    state = reduceViewerState(state, {
      kind: "model-changed",
      documentId: "doc-a",
      modelIdentity: "new-model",
    });

    expect(viewerDocument(state, "doc-a").measurements).toEqual([]);
    expect(viewerDocument(state, "doc-a").annotations).toHaveLength(1);
    expect(viewerDocument(state, "doc-b").annotations).toEqual([]);
  });

  it("tracks independent scene furniture and keeps annotations across model changes", () => {
    let state = createViewerState();
    state = reduceViewerState(state, {
      kind: "set-furniture",
      documentId: "doc-a",
      furniture: "edges",
      enabled: true,
    });
    state = reduceViewerState(state, {
      kind: "set-furniture",
      documentId: "doc-a",
      furniture: "grid",
      enabled: false,
    });

    expect(viewerDocument(state, "doc-a").furniture).toEqual({
      grid: false,
      axes: true,
      edges: true,
      shadow: false,
    });
    expect(viewerDocument(state, "doc-b").furniture).toEqual({
      grid: true,
      axes: true,
      edges: false,
      shadow: false,
    });
  });

  it("retains each document's last good geometry and clears measurements only for changed models", () => {
    let state = createViewerState();
    state = reduceViewerState(state, {
      kind: "add-point-measurement",
      documentId: "doc-a",
      measurement: { id: "m", start: [0, 0, 0], end: [10, 10, 10] },
    });
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "preview",
      result: cubeResult,
    });
    const first = viewerDocument(state, "doc-a");

    expect(first.presentation).toEqual({
      modelIdentity: "job-1",
      quality: "preview",
      result: cubeResult,
    });
    expect(first.measurements).toEqual([]);
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "full",
      result: cubeResult,
    });
    expect(viewerDocument(state, "doc-a").measurements).toEqual([]);
    expect(viewerDocument(state, "doc-b").presentation).toBeUndefined();
  });

  it("reuses model identity and measurements from a fixed-size matching geometry identity", () => {
    const firstResult: RenderSuccess3D = {
      ...cubeResult,
      mesh: {
        ...cubeResult.mesh,
        bytes: new Uint8Array([1, 2, 3, 4]),
        geometryIdentity: "sha256:same-geometry",
      },
    };
    const identicalResult: RenderSuccess3D = {
      ...cubeResult,
      mesh: {
        ...cubeResult.mesh,
        bytes: new Uint8Array([9, 8, 7, 6]),
        geometryIdentity: "sha256:same-geometry",
      },
    };
    let state = reduceViewerState(createViewerState(), {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "preview",
      result: firstResult,
    });
    state = reduceViewerState(state, {
      kind: "add-point-measurement",
      documentId: "doc-a",
      measurement: { id: "m", start: [0, 0, 0], end: [10, 10, 10] },
    });

    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-2",
      quality: "full",
      result: identicalResult,
    });

    expect(viewerDocument(state, "doc-a").modelIdentity).toBe("job-1");
    expect(viewerDocument(state, "doc-a").presentation?.modelIdentity).toBe("job-1");
    expect(viewerDocument(state, "doc-a").measurements).toHaveLength(1);
  });
});
