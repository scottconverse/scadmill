import { describe, expect, it } from "vitest";
import { createDocumentWorkspace, reduceDocumentWorkspace } from "../../../src/application/documents/document-workspace";
import type { RenderFailure, RenderSuccess3D } from "../../../src/application/engine/contracts";
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

describe("active viewer presentation", () => {
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
      result: failure,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
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
      result: success,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
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
      result: success,
    };

    expect(resolveActiveViewerPresentation({
      activeDocumentId: "document-main",
      documents,
      render,
      viewer: viewerDocument(createViewerState(), "document-main"),
    })).toMatchObject({ currentResult: success, result: success, stale: false, dimmed: false });
  });
});
