// @vitest-environment happy-dom

import { act, render, waitFor } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess3D } from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import type { RenderThumbnailPersistence } from "../../../src/application/render-cache/render-thumbnail-persistence";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { createDefaultViewerCamera, type ViewerDocumentState } from "../../../src/application/viewer/viewer-state";
import { ViewerPaneConnector } from "../../../src/ui/viewer/ViewerPaneConnector";

let reportFrameRendered: (() => void) | undefined;
const captureThumbnailPng = vi.fn<() => Promise<Uint8Array>>();

afterEach(() => vi.useRealTimers());

vi.mock("../../../src/ui/viewer/ModelViewer", () => ({
  ModelViewer: forwardRef(({ onFrameRendered, presentationToken }: {
    readonly onFrameRendered?: (durationMs: number, presentationToken?: string) => void;
    readonly presentationToken?: string;
  }, ref) => {
    reportFrameRendered = () => onFrameRendered?.(0, presentationToken);
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

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
    clipping: { enabled: false, axis: "x", offset: 0 },
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

function thumbnailProject(identity: string) {
  return {
    initialProject: createProjectSnapshot(
      `project-${identity}`,
      new Map([["main.scad", "cube(10);"]]),
      `workspace-${identity}`,
    ),
    initialScratchPath: "main.scad",
    initialScratchSource: "cube(10);",
  };
}

it("captures a session thumbnail without persistently saving an unsaved scratch document", async () => {
  captureThumbnailPng.mockReset().mockResolvedValue(Uint8Array.of(9));
  const save = vi.fn();
  const runtime = createWorkbenchRuntime({
    render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
  }, {
    renderThumbnailPersistence: {
      load: () => [], save, clear: vi.fn(), supportsWorkspace: () => false,
    },
  });
  const identity = `sha256:${"9".repeat(64)}`;
  const viewer = presentation(identity, identity);
  const view = render(
    <ViewerPaneConnector
      colors={colors} dimmed={false} documentId="document-main" maximized={false}
      narrow={false} onLayoutAction={vi.fn()} onShowConsole={vi.fn()}
      renderStatus="success" result={viewer.presentation?.result} runtime={runtime}
      viewer={viewer}
    />,
  );
  await view.findByTestId("model-viewer");
  await waitFor(() => expect(reportFrameRendered).toBeDefined());

  act(() => reportFrameRendered?.());
  await act(() => delay(300));

  expect(captureThumbnailPng).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  view.unmount();
  runtime.dispose();
});

it("captures an automatic thumbnail for a browser-supported scratch workspace", async () => {
  captureThumbnailPng.mockReset().mockResolvedValue(Uint8Array.of(7));
  const save = vi.fn();
  const runtime = createWorkbenchRuntime({
    render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
  }, {
    renderThumbnailPersistence: {
      load: () => [], save, clear: vi.fn(), supportsWorkspace: () => true,
    },
  });
  const identity = `sha256:${"8".repeat(64)}`;
  const viewer = presentation(identity, identity);
  const view = render(
    <ViewerPaneConnector
      colors={colors} dimmed={false} documentId="document-main" maximized={false}
      narrow={false} onLayoutAction={vi.fn()} onShowConsole={vi.fn()}
      renderStatus="success" result={viewer.presentation?.result} runtime={runtime}
      viewer={viewer}
    />,
  );
  await view.findByTestId("model-viewer");
  await waitFor(() => expect(reportFrameRendered).toBeDefined());

  act(() => reportFrameRendered?.());
  await act(() => delay(300));

  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith("scratch", expect.objectContaining({
    documentPath: "main.scad",
    renderIdentity: identity,
    pngBytes: Uint8Array.of(7),
  }));
  view.unmount();
  runtime.dispose();
});

it("persists the newest 3D thumbnail when its frame arrives during an older capture", async () => {
  const firstCapture = deferred<Uint8Array>();
  const secondCapture = deferred<Uint8Array>();
  captureThumbnailPng
    .mockReset()
    .mockReturnValueOnce(firstCapture.promise)
    .mockReturnValueOnce(secondCapture.promise);
  const save = vi.fn();
  const renderThumbnails: RenderThumbnailPersistence = {
    supportsWorkspace: () => true,
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
  const runtime = createWorkbenchRuntime(engine, {
    ...thumbnailProject("newest"),
    renderThumbnailPersistence: renderThumbnails,
  });
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
  expect(captureThumbnailPng).not.toHaveBeenCalled();
  await act(() => delay(200));
  act(() => reportFrameRendered?.());
  await act(() => delay(120));
  expect(captureThumbnailPng).not.toHaveBeenCalled();
  await act(() => delay(150));
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
  await act(() => delay(120));
  expect(captureThumbnailPng).toHaveBeenCalledOnce();
  await act(() => delay(150));

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
    supportsWorkspace: () => true,
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
  expect(captureThumbnailPng).not.toHaveBeenCalled();
  await act(() => delay(300));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());

  const secondDocumentId = secondRuntime.documents.getState().activeDocumentId ?? "";
  view.rerender(
    <ViewerPaneConnector {...props} documentId={secondDocumentId} runtime={secondRuntime} />,
  );
  act(() => reportFrameRendered?.());
  await act(() => delay(300));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));

  expect(save.mock.calls).toEqual([
    ["workspace-a", expect.objectContaining({ documentPath: "main.scad", renderIdentity: sharedIdentity, pngBytes: Uint8Array.of(1) })],
    ["workspace-b", expect.objectContaining({ documentPath: "parts/widget.scad", renderIdentity: sharedIdentity, pngBytes: Uint8Array.of(2) })],
  ]);
  firstRuntime.dispose();
  secondRuntime.dispose();
});

it("cancels a scheduled automatic thumbnail when the viewer unmounts", async () => {
  captureThumbnailPng.mockReset().mockResolvedValue(Uint8Array.of(1));
  const runtime = createWorkbenchRuntime({
    render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
  }, {
    ...thumbnailProject("unmount"),
    renderThumbnailPersistence: { supportsWorkspace: () => true, load: () => [], save: vi.fn(), clear: vi.fn() },
  });
  const identity = `sha256:${"4".repeat(64)}`;
  const viewer = presentation(identity, identity);
  const view = render(
    <ViewerPaneConnector
      colors={colors} dimmed={false} documentId="document-main" maximized={false}
      narrow={false} onLayoutAction={vi.fn()} onShowConsole={vi.fn()}
      renderStatus="success" result={viewer.presentation?.result} runtime={runtime}
      viewer={viewer}
    />,
  );
  await view.findByTestId("model-viewer");
  await waitFor(() => expect(reportFrameRendered).toBeDefined());

  act(() => reportFrameRendered?.());
  view.unmount();
  await act(() => delay(300));

  expect(captureThumbnailPng).not.toHaveBeenCalled();
  runtime.dispose();
});

it("drops a scheduled old frame until the new identity actually renders", async () => {
  captureThumbnailPng.mockReset().mockResolvedValue(Uint8Array.of(7));
  const save = vi.fn();
  const runtime = createWorkbenchRuntime({
    render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
  }, {
    ...thumbnailProject("superseded"),
    renderThumbnailPersistence: { supportsWorkspace: () => true, load: () => [], save, clear: vi.fn() },
  });
  const firstIdentity = `sha256:${"5".repeat(64)}`;
  const secondIdentity = `sha256:${"6".repeat(64)}`;
  const firstViewer = presentation("render-a", firstIdentity);
  const secondViewer = presentation("render-b", secondIdentity);
  const common = {
    colors, dimmed: false, documentId: "document-main", maximized: false,
    narrow: false, onLayoutAction: vi.fn(), onShowConsole: vi.fn(),
    renderStatus: "success" as const, runtime,
  };
  const view = render(
    <ViewerPaneConnector {...common} result={firstViewer.presentation?.result} viewer={firstViewer} />,
  );
  await view.findByTestId("model-viewer");
  await waitFor(() => expect(reportFrameRendered).toBeDefined());
  act(() => reportFrameRendered?.());

  view.rerender(
    <ViewerPaneConnector {...common} result={secondViewer.presentation?.result} viewer={secondViewer} />,
  );
  await act(() => delay(300));
  expect(captureThumbnailPng).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();

  act(() => reportFrameRendered?.());
  await act(() => delay(300));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    renderIdentity: secondIdentity,
    pngBytes: Uint8Array.of(7),
  }));
  view.unmount();
  runtime.dispose();
});

it("bounds thumbnail delay while rendered frames keep arriving", async () => {
  captureThumbnailPng.mockReset().mockResolvedValue(Uint8Array.of(8));
  const runtime = createWorkbenchRuntime({
    render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
  }, {
    ...thumbnailProject("bounded"),
    renderThumbnailPersistence: { supportsWorkspace: () => true, load: () => [], save: vi.fn(), clear: vi.fn() },
  });
  const identity = `sha256:${"7".repeat(64)}`;
  const viewer = presentation(identity, identity);
  const view = render(
    <ViewerPaneConnector
      colors={colors} dimmed={false} documentId="document-main" maximized={false}
      narrow={false} onLayoutAction={vi.fn()} onShowConsole={vi.fn()}
      renderStatus="success" result={viewer.presentation?.result} runtime={runtime}
      viewer={viewer}
    />,
  );
  await view.findByTestId("model-viewer");
  await waitFor(() => expect(reportFrameRendered).toBeDefined());

  for (let frame = 0; frame < 10; frame += 1) {
    act(() => reportFrameRendered?.());
    await act(() => delay(100));
  }
  await act(() => delay(75));

  expect(captureThumbnailPng).toHaveBeenCalledOnce();
  view.unmount();
  runtime.dispose();
});
