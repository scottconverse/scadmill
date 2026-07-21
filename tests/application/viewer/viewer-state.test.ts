import { describe, expect, it } from "vitest";
import type {
  RenderSuccess2D,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
import {
  createViewerState,
  reduceViewerState,
  viewerDocument,
} from "../../../src/application/viewer/viewer-state";

const cubeResult: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { boundingBox: { min: [0, 0, 0], max: [10, 10, 10] }, engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "",
};
const GEOMETRY_A = `sha256:${"a".repeat(64)}`;
const GEOMETRY_B = `sha256:${"b".repeat(64)}`;

describe("per-document viewer state", () => {
  it("stores a bounded axis-aligned clipping plane per document", () => {
    let state = createViewerState();
    expect(viewerDocument(state, "doc-a").clipping).toEqual({
      enabled: false,
      axis: "x",
      offset: 0,
    });

    state = reduceViewerState(state, {
      kind: "set-clipping",
      documentId: "doc-a",
      clipping: { enabled: true, axis: "z", offset: 4.5 },
    });

    expect(viewerDocument(state, "doc-a").clipping).toEqual({
      enabled: true,
      axis: "z",
      offset: 4.5,
    });
    expect(viewerDocument(state, "doc-b").clipping.enabled).toBe(false);
    expect(() => reduceViewerState(state, {
      kind: "set-clipping",
      documentId: "doc-a",
      clipping: { enabled: true, axis: "z", offset: Number.NaN },
    })).toThrow(/clipping/iu);
  });

  it("defaults each document to automatic mode and isolates pinned modes", () => {
    let state = createViewerState();

    expect(viewerDocument(state, "doc-a").mode).toBe("auto");

    state = reduceViewerState(state, {
      kind: "set-mode",
      documentId: "doc-a",
      mode: "2d",
    });

    expect(state).toBeDefined();
    expect(viewerDocument(state, "doc-a").mode).toBe("2d");
    expect(viewerDocument(state, "doc-b").mode).toBe("auto");
  });

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
      renderIdentity: "job-1",
      quality: "preview",
      result: cubeResult,
      geometryDelta: { kind: "baseline" },
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
        geometryIdentity: GEOMETRY_A,
      },
    };
    const identicalResult: RenderSuccess3D = {
      ...cubeResult,
      mesh: {
        ...cubeResult.mesh,
        bytes: new Uint8Array([9, 8, 7, 6]),
        geometryIdentity: GEOMETRY_A,
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
    expect(viewerDocument(state, "doc-a").presentation?.renderIdentity).toBe("job-2");
    expect(viewerDocument(state, "doc-a").measurements).toHaveLength(1);
  });

  it("labels the first accepted geometry as a baseline and a matching hash as unchanged", () => {
    const firstResult: RenderSuccess3D = {
      ...cubeResult,
      mesh: { ...cubeResult.mesh, geometryIdentity: GEOMETRY_A },
    };
    const identicalResult: RenderSuccess3D = {
      ...cubeResult,
      mesh: {
        ...cubeResult.mesh,
        bytes: new Uint8Array(84),
        geometryIdentity: GEOMETRY_A,
      },
    };
    let state = reduceViewerState(createViewerState(), {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "preview",
      result: firstResult,
    });

    expect(viewerDocument(state, "doc-a").presentation?.geometryDelta).toEqual({
      kind: "baseline",
    });

    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-2",
      quality: "full",
      result: identicalResult,
    });

    expect(viewerDocument(state, "doc-a").presentation?.geometryDelta).toEqual({
      kind: "unchanged",
    });
  });

  it("computes signed volume, triangle, and complete bounding-box deltas", () => {
    const firstResult: RenderSuccess3D = {
      ...cubeResult,
      mesh: { ...cubeResult.mesh, geometryIdentity: GEOMETRY_A },
      stats: {
        ...cubeResult.stats,
        triangles: 12,
        volumeMm3: 1_000,
      },
    };
    const changedResult: RenderSuccess3D = {
      ...cubeResult,
      mesh: {
        ...cubeResult.mesh,
        bytes: new Uint8Array(84),
        geometryIdentity: GEOMETRY_B,
      },
      stats: {
        ...cubeResult.stats,
        triangles: 16,
        volumeMm3: 1_250,
        boundingBox: { min: [2, -1, 0], max: [14, 12, 15] },
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
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-2",
      quality: "full",
      result: changedResult,
    });

    expect(viewerDocument(state, "doc-a").presentation?.geometryDelta).toEqual({
      kind: "changed",
      dimensions: 3,
      volumeMm3: 250,
      triangles: 4,
      boundingBox: {
        min: [2, -1, 0],
        max: [4, 2, 5],
        size: [2, 3, 5],
      },
    });
  });

  it("treats distinct strong identities as changed even when an adapter reuses a byte view", () => {
    const bytes = new Uint8Array(84);
    let state = reduceViewerState(createViewerState(), {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "preview",
      result: {
        ...cubeResult,
        mesh: { ...cubeResult.mesh, bytes, geometryIdentity: GEOMETRY_A },
      },
    });
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-2",
      quality: "preview",
      result: {
        ...cubeResult,
        mesh: { ...cubeResult.mesh, bytes, geometryIdentity: GEOMETRY_B },
      },
    });

    expect(viewerDocument(state, "doc-a").presentation).toMatchObject({
      modelIdentity: "job-2",
      geometryDelta: { kind: "changed" },
    });
  });

  it("treats a matching two-dimensional strong identity as authoritative", () => {
    const first: RenderSuccess2D = {
      kind: "2d",
      svg: "<svg><path d='M0 0L10 10'/></svg>",
      geometryIdentity: GEOMETRY_A,
      boundingBox: { min: [0, 0], max: [10, 10] },
      diagnostics: [],
      rawLog: "",
    };
    let state = reduceViewerState(createViewerState(), {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "preview",
      result: first,
    });
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-2",
      quality: "full",
      result: {
        ...first,
        boundingBox: { min: [-1, -1], max: [11, 11] },
      },
    });

    expect(viewerDocument(state, "doc-a").presentation).toMatchObject({
      modelIdentity: "job-1",
      geometryDelta: { kind: "unchanged" },
    });
  });

  it("reports comparison unavailable when distinct three-dimensional results lack hashes", () => {
    let state = reduceViewerState(createViewerState(), {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "preview",
      result: { ...cubeResult, mesh: { ...cubeResult.mesh, bytes: new Uint8Array(84) } },
    });
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-2",
      quality: "preview",
      result: { ...cubeResult, mesh: { ...cubeResult.mesh, bytes: new Uint8Array(84) } },
    });

    expect(viewerDocument(state, "doc-a").presentation?.geometryDelta).toEqual({
      kind: "unavailable",
    });
  });

  it("does not treat malformed matching identity strings as strong proof", () => {
    let state = reduceViewerState(createViewerState(), {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-1",
      quality: "preview",
      result: {
        ...cubeResult,
        mesh: { ...cubeResult.mesh, bytes: new Uint8Array(84), geometryIdentity: "same" },
      },
    });
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "job-2",
      quality: "preview",
      result: {
        ...cubeResult,
        mesh: { ...cubeResult.mesh, bytes: new Uint8Array(84), geometryIdentity: "same" },
      },
    });

    expect(viewerDocument(state, "doc-a").presentation?.geometryDelta).toEqual({
      kind: "unavailable",
    });
  });

  it("keeps independent geometry baselines for interleaved documents", () => {
    const first = {
      ...cubeResult,
      mesh: { ...cubeResult.mesh, bytes: new Uint8Array(84), geometryIdentity: GEOMETRY_A },
      stats: { ...cubeResult.stats, volumeMm3: 100 },
    };
    let state = reduceViewerState(createViewerState(), {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "a-1",
      quality: "preview",
      result: first,
    });
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-b",
      modelIdentity: "b-1",
      quality: "preview",
      result: first,
    });
    state = reduceViewerState(state, {
      kind: "present-result",
      documentId: "doc-a",
      modelIdentity: "a-2",
      quality: "full",
      result: {
        ...first,
        mesh: { ...first.mesh, bytes: new Uint8Array(85), geometryIdentity: GEOMETRY_B },
        stats: { ...first.stats, volumeMm3: 125 },
      },
    });

    expect(viewerDocument(state, "doc-a").presentation?.geometryDelta).toMatchObject({
      kind: "changed",
      volumeMm3: 25,
    });
    expect(viewerDocument(state, "doc-b").presentation?.geometryDelta).toEqual({
      kind: "baseline",
    });
    expect(viewerDocument(state, "doc-c").presentation).toBeUndefined();
  });
});
