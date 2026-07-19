import { describe, expect, it } from "vitest";
import { createDocumentWorkspace, reduceDocumentWorkspace } from "../../../src/application/documents/document-workspace";
import type {
  RenderFailure,
  RenderSuccess2D,
  RenderSuccess3D,
} from "../../../src/application/engine/contracts";
import {
  createParameterState,
  reduceParameterState,
} from "../../../src/application/parameters/parameter-state";
import type { RenderState } from "../../../src/application/runtime/workbench-runtime";
import { createViewerState, reduceViewerState, viewerDocument } from "../../../src/application/viewer/viewer-state";
import { resolveActiveViewerPresentation } from "../../../src/ui/viewer/active-viewer-presentation";

const success: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "",
};
const failure: RenderFailure = {
  kind: "failure",
  reason: "engine-error",
  diagnostics: [],
  rawLog: "failed",
};
const drawing: RenderSuccess2D = {
  kind: "2d",
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L30 0 L30 -20 Z"/></svg>',
  boundingBox: { min: [0, 0], max: [30, 20] },
  diagnostics: [],
  rawLog: "",
};

describe("active viewer presentation", () => {
  it("keeps a transient $t render current without weakening real parameter staleness", () => {
    const source = "width = 10; rotate($t * 360) cube(width);";
    const documents = reduceDocumentWorkspace(createDocumentWorkspace(), {
      kind: "edit",
      documentId: "document-main",
      source,
    });
    let parameters = createParameterState([{
      documentId: "document-main",
      revision: 1,
      source,
    }]);
    parameters = reduceParameterState(parameters, {
      kind: "set-value",
      documentId: "document-main",
      name: "width",
      value: 25,
    });
    const render: RenderState = {
      status: "success",
      quality: "preview",
      documentId: "document-main",
      sourceRevision: 1,
      sourceFiles: new Map([["main.scad", source]]),
      parameterValues: { width: 25 },
      result: success,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      parameters,
      render,
      viewer: viewerDocument(createViewerState(), "document-main"),
    })).toMatchObject({ currentResult: success, stale: false, dimmed: false });

    parameters = reduceParameterState(parameters, {
      kind: "set-value",
      documentId: "document-main",
      name: "width",
      value: 30,
    });
    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      parameters,
      render,
      viewer: viewerDocument(createViewerState(), "document-main"),
    })).toMatchObject({ currentResult: undefined, stale: true });
  });

  it("dims last-good geometry when only the active parameter override changed", () => {
    const source = "width = 10; cube(width);";
    const documents = reduceDocumentWorkspace(createDocumentWorkspace(), {
      kind: "edit",
      documentId: "document-main",
      source,
    });
    let parameters = createParameterState([
      { documentId: "document-main", revision: 1, source },
    ]);
    parameters = reduceParameterState(parameters, {
      kind: "set-value",
      documentId: "document-main",
      name: "width",
      value: 30,
    });
    let viewer = createViewerState();
    viewer = reduceViewerState(viewer, {
      kind: "present-result",
      documentId: "document-main",
      modelIdentity: "width-20",
      quality: "preview",
      result: success,
    });
    const render: RenderState = {
      status: "success",
      documentId: "document-main",
      sourceRevision: 1,
      sourceFiles: new Map([["main.scad", source]]),
      parameterValues: { width: 20 },
      result: success,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      parameters,
      render,
      viewer: viewerDocument(viewer, "document-main"),
    })).toMatchObject({
      currentResult: undefined,
      result: success,
      stale: true,
      dimmed: true,
    });
  });

  it("routes a current two-dimensional engine result to the active viewer", () => {
    const documents = reduceDocumentWorkspace(createDocumentWorkspace(), {
      kind: "edit",
      documentId: "document-main",
      source: "square([30,20]);",
    });
    const render: RenderState = {
      status: "success",
      documentId: "document-main",
      sourceRevision: 1,
      sourceFiles: new Map([["main.scad", "square([30,20]);"]]),
      parameterValues: {},
      result: drawing,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      parameters: createParameterState([{
        documentId: "document-main",
        revision: 1,
        source: "square([30,20]);",
      }]),
      render,
      viewer: viewerDocument(createViewerState(), "document-main"),
    })).toMatchObject({ currentResult: drawing, result: drawing, stale: false, dimmed: false });
  });

  it("keeps the last good geometry dimmed while a current render fails", () => {
    const documents = createDocumentWorkspace();
    let viewer = createViewerState();
    viewer = reduceViewerState(viewer, {
      kind: "present-result",
      documentId: "document-main",
      modelIdentity: "good-job",
      quality: "preview",
      result: success,
    });
    const render: RenderState = {
      status: "failure",
      jobId: "failed-job",
      documentId: "document-main",
      entryFile: "main.scad",
      sourceRevision: 0,
      sourceFiles: new Map([["main.scad", "cube(10);"]]),
      parameterValues: {},
      result: failure,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      parameters: createParameterState([{
        documentId: "document-main",
        revision: 0,
        source: "cube(10);",
      }]),
      render,
      viewer: viewerDocument(viewer, "document-main"),
    })).toMatchObject({ result: success, failure, dimmed: true, status: "failure" });
  });

  it("falls back to the per-document last good result after an edit makes a run stale", () => {
    const initial = createDocumentWorkspace();
    const documents = reduceDocumentWorkspace(initial, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(11);",
    });
    let viewer = createViewerState();
    viewer = reduceViewerState(viewer, {
      kind: "present-result",
      documentId: "document-main",
      modelIdentity: "old-job",
      quality: "preview",
      result: success,
    });
    const render: RenderState = {
      status: "success",
      documentId: "document-main",
      sourceRevision: 0,
      sourceFiles: new Map([["main.scad", "cube(10);"]]),
      parameterValues: {},
      result: success,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      parameters: createParameterState([{
        documentId: "document-main",
        revision: 1,
        source: "cube(11);",
      }]),
      render,
      viewer: viewerDocument(viewer, "document-main"),
    })).toMatchObject({ result: success, stale: true, dimmed: true });
  });

  it("keeps a complete project render current when only a subset of its text files are open", () => {
    const documents = createDocumentWorkspace();
    const render: RenderState = {
      status: "success",
      documentId: "document-main",
      entryFile: "main.scad",
      sourceRevision: 0,
      sourceFiles: new Map([
        ["main.scad", "cube(10);"],
        ["lib/unopened.scad", "module helper() { sphere(1); }"],
      ]),
      projectRevision: 0,
      parameterValues: {},
      result: success,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      parameters: createParameterState([{
        documentId: "document-main",
        revision: 0,
        source: "cube(10);",
      }]),
      render,
      viewer: viewerDocument(createViewerState(), "document-main"),
    })).toMatchObject({ currentResult: success, result: success, stale: false, dimmed: false });
  });
});
