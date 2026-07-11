// @vitest-environment happy-dom
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { createViewerState, viewerDocument } from "../../../src/application/viewer/viewer-state";
import { ViewerPaneConnector } from "../../../src/ui/viewer/ViewerPaneConnector";

let paneProps: Record<string, unknown> = {};

vi.mock("../../../src/ui/viewer/ViewerPane", () => ({
  ViewerPane: (props: Record<string, unknown>) => {
    paneProps = props;
    return <div data-testid="connected-viewer" />;
  },
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

beforeEach(() => {
  paneProps = {};
});

it("forwards engine availability to the dependency-aware empty viewer", () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine);
  const props = {
    colors,
    dimmed: false,
    documentId: "doc",
    engineAvailable: false,
    maximized: false,
    narrow: false,
    renderStatus: "idle" as const,
    runtime,
    viewer: viewerDocument(createViewerState(), "doc"),
    onLayoutAction: vi.fn(),
    onShowConsole: vi.fn(),
  };

  render(<ViewerPaneConnector {...props} />);

  expect(paneProps.engineAvailable).toBe(false);
});

it("uses C9 viewer preferences as the live projection, furniture, mouse, and color authority", async () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine);
  const profile = runtime.settings.getState().profile;
  await runtime.dispatch({
    kind: "replace-settings",
    origin: "user",
    settings: {
      ...profile,
      viewer: {
        projection: "orthographic",
        orbitButton: "middle",
        panButton: "left",
        showGrid: false,
        showAxes: true,
        showEdges: true,
        showShadow: true,
        meshColor: "#123456",
      },
    },
  });
  render(
    <ViewerPaneConnector
      colors={colors}
      dimmed={false}
      documentId="doc"
      maximized={false}
      narrow={false}
      renderStatus="idle"
      runtime={runtime}
      viewer={viewerDocument(createViewerState(), "doc")}
      onLayoutAction={vi.fn()}
      onShowConsole={vi.fn()}
    />,
  );

  expect(paneProps.viewer).toMatchObject({
    camera: { projection: "orthographic" },
    furniture: { grid: false, axes: true, edges: true, shadow: true },
  });
  expect(paneProps.mouseMapping).toEqual({ orbit: "middle", pan: "left" });
  expect(paneProps.meshColor).toBe("#123456");

  await act(async () => {
    (paneProps.onViewerAction as (action: unknown) => void)({
      kind: "set-furniture",
      documentId: "doc",
      furniture: "grid",
      enabled: true,
    });
  });
  await waitFor(() => expect(runtime.settings.getState().profile.viewer.showGrid).toBe(true));
  expect(runtime.viewer.getState().documents.get("doc")).toBeUndefined();

  await act(async () => {
    (paneProps.onViewerAction as (action: unknown) => void)({
      kind: "set-camera",
      documentId: "doc",
      camera: {
        projection: "perspective",
        position: [10, 10, 10],
        target: [0, 0, 0],
        up: [0, 0, 1],
        zoom: 1,
      },
    });
  });
  await waitFor(() => expect(runtime.settings.getState().profile.viewer.projection).toBe("perspective"));
});

it("saves a captured PNG through the configured artifact destination", async () => {
  const save = vi.fn().mockResolvedValue({ location: "cube.png" });
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, {
    artifactDestination: { available: true, save },
  });
  render(
    <ViewerPaneConnector
      colors={colors}
      dimmed={false}
      documentId="doc"
      maximized={false}
      narrow={false}
      renderStatus="idle"
      runtime={runtime}
      viewer={viewerDocument(createViewerState(), "doc")}
      onLayoutAction={vi.fn()}
      onShowConsole={vi.fn()}
    />,
  );

  await (paneProps.onScreenshot as (bytes: Uint8Array) => Promise<void>)(Uint8Array.of(1, 2, 3));

  expect(save).toHaveBeenCalledWith({
    suggestedName: "doc.png",
    bytes: Uint8Array.of(1, 2, 3),
    mimeType: "image/png",
  });
});
