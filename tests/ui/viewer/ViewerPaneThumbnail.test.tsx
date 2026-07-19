// @vitest-environment happy-dom

import { act, render, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess3D } from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import type { RenderThumbnailPersistence } from "../../../src/application/render-cache/render-thumbnail-persistence";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { createDefaultViewerCamera, type ViewerDocumentState } from "../../../src/application/viewer/viewer-state";
import { ViewerPaneConnector } from "../../../src/ui/viewer/ViewerPaneConnector";

let reportFrameRendered: (() => void) | undefined;
const captureThumbnailPng = vi.fn<() => Promise<Uint8Array>>();

vi.mock("../../../src/ui/viewer/ModelViewer", () => ({
  ModelViewer: forwardRef(({ onFrameRendered }: { readonly onFrameRendered?: () => void }, ref) => {
    reportFrameRendered = onFrameRendered;
    useImperativeHandle(ref, () => ({
      capturePng: vi.fn(),
      captureThumbnailPng,
    }));
    return <div data-testid="model-viewer" />;
  }),
}));

vi.mock("../../../src/ui/viewer/SvgViewer", () => ({
  SvgViewer: () => <div data-testid="svg-viewer" />,
}));

const colors = {
  background: "#000000",
  mesh: "#ffffff",
  meshHighlight: "#ffffff",
  edges: "#ffffff",
  grid: "#ffffff",
  gridMajor: "#ffffff",
  axisX: "#ffffff",
  axisY: "#ffffff",
  axisZ: "#ffffff",
  measurement: "#ffffff",
  annotation: "#ffffff",
  clippingCap: "#ffffff",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function presentation(renderIdentity: string, geometryIdentity: string): ViewerDocumentState {
  const result: RenderSuccess3D = {
    kind: "3d",
    mesh: {
      format: "stl-binary",
      bytes: new Uint8Array(84),
      geometryIdentity,
    },
    stats: { engineTimeMs: 1 },
    diagnostics: [],
    rawLog: "",
  };
  return {
    camera: createDefaultViewerCamera(),
    mode: "auto",
    furniture: { grid: true, axes: true, edges: false, shadow: false },
    measurements: [],
    annotations: [],
    presentation: {
      modelIdentity: geometryIdentity,
      renderIdentity,
      quality: "preview",
      result,
      geometryDelta: { kind: "baseline" },
    },
  };
}

it("persists the newest 3D thumbnail when its frame arrives during an older capture", async () => {
  const firstCapture = deferred<Uint8Array>();
  const secondCapture = deferred<Uint8Array>();
  captureThumbnailPng
    .mockReset()
    .mockReturnValueOnce(firstCapture.promise)
    .mockReturnValueOnce(secondCapture.promise);
  const save = vi.fn();
  const renderThumbnails: RenderThumbnailPersistence = {
    load: () => [],
    save,
    clear: vi.fn(),
  };
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, { renderThumbnailPersistence: renderThumbnails });
  const firstIdentity = `sha256:${"1".repeat(64)}`;
  const newestIdentity = `sha256:${"2".repeat(64)}`;
  const common = {
    colors,
    dimmed: false,
    documentId: "document-main",
    maximized: false,
    narrow: false,
    renderStatus: "success" as const,
    runtime,
    onLayoutAction: vi.fn(),
    onShowConsole: vi.fn(),
  };
  const view = render(
    <ViewerPaneConnector
      {...common}
      result={presentation("render-1", firstIdentity).presentation?.result}
      viewer={presentation("render-1", firstIdentity)}
    />,
  );
  await view.findByTestId("model-viewer");
  await waitFor(() => expect(reportFrameRendered).toBeDefined());

  act(() => reportFrameRendered?.());
  expect(captureThumbnailPng).toHaveBeenCalledOnce();

  view.rerender(
    <ViewerPaneConnector
      {...common}
      result={presentation("render-2", newestIdentity).presentation?.result}
      viewer={presentation("render-2", newestIdentity)}
    />,
  );
  act(() => reportFrameRendered?.());
  firstCapture.resolve(Uint8Array.of(1));

  await waitFor(() => expect(captureThumbnailPng).toHaveBeenCalledTimes(2));
  secondCapture.resolve(Uint8Array.of(2));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());

  expect(save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    documentPath: "main.scad",
    renderIdentity: newestIdentity,
    pngBytes: Uint8Array.of(2),
  }));
  runtime.dispose();
});

it("captures the same render identity for each distinct project and document destination", async () => {
  captureThumbnailPng
    .mockReset()
    .mockResolvedValueOnce(Uint8Array.of(1))
    .mockResolvedValueOnce(Uint8Array.of(2));
  const save = vi.fn();
  const renderThumbnails: RenderThumbnailPersistence = {
    load: () => [],
    save,
    clear: vi.fn(),
  };
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const firstRuntime = createWorkbenchRuntime(engine, {
    initialProject: createProjectSnapshot("project-a", new Map([["main.scad", "cube(10);"]]), "workspace-a"),
    initialScratchPath: "main.scad",
    initialScratchSource: "cube(10);",
    renderThumbnailPersistence: renderThumbnails,
  });
  const secondRuntime = createWorkbenchRuntime(engine, {
    initialProject: createProjectSnapshot("project-b", new Map([["parts/widget.scad", "cube(10);"]]), "workspace-b"),
    initialScratchPath: "parts/widget.scad",
    initialScratchSource: "cube(10);",
    renderThumbnailPersistence: renderThumbnails,
  });
  const sharedIdentity = `sha256:${"3".repeat(64)}`;
  const sharedViewer = presentation(sharedIdentity, sharedIdentity);
  const props = {
    colors,
    dimmed: false,
    maximized: false,
    narrow: false,
    renderStatus: "success" as const,
    result: sharedViewer.presentation?.result,
    viewer: sharedViewer,
    onLayoutAction: vi.fn(),
    onShowConsole: vi.fn(),
  };
  const firstDocumentId = firstRuntime.documents.getState().activeDocumentId ?? "";
  const view = render(
    <ViewerPaneConnector {...props} documentId={firstDocumentId} runtime={firstRuntime} />,
  );
  await view.findByTestId("model-viewer");
  await waitFor(() => expect(reportFrameRendered).toBeDefined());

  act(() => reportFrameRendered?.());
  await waitFor(() => expect(save).toHaveBeenCalledOnce());

  const secondDocumentId = secondRuntime.documents.getState().activeDocumentId ?? "";
  view.rerender(
    <ViewerPaneConnector {...props} documentId={secondDocumentId} runtime={secondRuntime} />,
  );
  act(() => reportFrameRendered?.());
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

  expect(save.mock.calls).toEqual([
    ["workspace-a", expect.objectContaining({ documentPath: "main.scad", renderIdentity: sharedIdentity, pngBytes: Uint8Array.of(1) })],
    ["workspace-b", expect.objectContaining({ documentPath: "parts/widget.scad", renderIdentity: sharedIdentity, pngBytes: Uint8Array.of(2) })],
  ]);
  firstRuntime.dispose();
  secondRuntime.dispose();
});
