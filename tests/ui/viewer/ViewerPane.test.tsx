// @vitest-environment happy-dom
import { forwardRef, useImperativeHandle } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import { DEFAULT_KEYBINDINGS } from "../../../src/application/commands/default-keybindings";
import { ViewerPane } from "../../../src/ui/viewer/ViewerPane";

vi.mock("../../../src/ui/viewer/ModelViewer", () => ({
  ModelViewer: forwardRef(({ dimmed, onPointPick }: {
    dimmed?: boolean;
    onPointPick?: (point: readonly [number, number, number]) => void;
  }, ref) => {
    useImperativeHandle(ref, () => ({
      capturePng: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    }));
    return (
      <button
        data-dimmed={dimmed ? "true" : "false"}
        data-testid="model-viewer"
        onClick={() => onPointPick?.([1, 2, 3])}
        type="button"
      >3D</button>
    );
  }),
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

const threeD: RenderSuccess3D = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { boundingBox: { min: [0, 0, 0], max: [10, 10, 10] }, engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "",
};

describe("ViewerPane result routing", () => {
  it("keeps last-good geometry dimmed while rendering and exposes cancel", async () => {
    const onCancel = vi.fn();
    const view = render(
      <ViewerPane
        colors={colors}
        dimmed
        maximized={false}
        narrow={false}
        renderStatus="rendering"
        result={threeD}
        onCancel={onCancel}
        onLayoutAction={vi.fn()}
      />,
    );

    expect(await view.findByTestId("model-viewer")).toHaveAttribute("data-dimmed", "true");
    expect(view.getByRole("status", { name: "Render progress" })).toHaveTextContent(/rendering/i);
    fireEvent.click(view.getByRole("button", { name: /cancel render/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("links a failed render to the console while preserving last-good geometry", () => {
    const showConsole = vi.fn();
    const view = render(
      <ViewerPane
        colors={colors}
        dimmed
        failure={{
          kind: "failure",
          reason: "engine-error",
          diagnostics: [{ severity: "error", message: "Parser error" }],
          rawLog: "ERROR: Parser error",
        }}
        maximized={false}
        narrow={false}
        renderStatus="failure"
        result={threeD}
        onLayoutAction={vi.fn()}
        onShowConsole={showConsole}
      />,
    );

    expect(view.getByTestId("model-viewer")).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: /show render error in console/i }));
    expect(showConsole).toHaveBeenCalledOnce();
    expect(view.queryByText("ERROR: Parser error")).not.toBeInTheDocument();
  });

  it("turns two pointer picks into one point-to-point measurement action", async () => {
    const onViewerAction = vi.fn();
    const view = render(
      <ViewerPane
        colors={colors}
        maximized={false}
        narrow={false}
        renderStatus="success"
        result={threeD}
        viewer={{
          camera: {
            projection: "perspective",
            position: [28, 24, 28],
            target: [0, 0, 0],
            up: [0, 0, 1],
            zoom: 1,
          },
          furniture: { grid: true, axes: true, edges: false, shadow: false },
          measurements: [],
          annotations: [],
        }}
        onLayoutAction={vi.fn()}
        onViewerAction={onViewerAction}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Measure point-to-point distance" }));
    fireEvent.click(view.getByTestId("model-viewer"));
    fireEvent.click(view.getByTestId("model-viewer"));

    await waitFor(() => expect(onViewerAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: "add-point-measurement",
      measurement: expect.objectContaining({ start: [1, 2, 3], end: [1, 2, 3] }),
    })));
  });

  it("clears transient tools, drafts, and partial measurements when the document changes", () => {
    const onViewerAction = vi.fn();
    const common = {
      colors,
      maximized: false,
      narrow: false,
      renderStatus: "success" as const,
      result: threeD,
      viewer: {
        camera: {
          projection: "perspective" as const,
          position: [28, 24, 28] as const,
          target: [0, 0, 0] as const,
          up: [0, 0, 1] as const,
          zoom: 1,
        },
        modelIdentity: "shared-model-identity",
        furniture: { grid: true, axes: true, edges: false, shadow: false },
        measurements: [],
        annotations: [],
      },
      onLayoutAction: vi.fn(),
      onViewerAction,
    };
    const view = render(<ViewerPane {...common} documentId="document-a" />);

    fireEvent.click(view.getByRole("button", { name: "Measure point-to-point distance" }));
    fireEvent.click(view.getByTestId("model-viewer"));
    expect(view.getByText(/first measurement point selected/i)).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Pin an annotation" }));
    fireEvent.change(view.getByLabelText("Annotation text"), { target: { value: "belongs to A" } });

    view.rerender(<ViewerPane {...common} documentId="document-b" />);

    expect(view.getByRole("button", { name: "Navigate model" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByLabelText("Annotation text")).toHaveValue("");
    expect(view.queryByText(/first measurement point selected/i)).not.toBeInTheDocument();
    fireEvent.click(view.getByTestId("model-viewer"));
    expect(onViewerAction).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: "add-point-measurement",
    }));
  });

  it("captures scene-only PNG bytes through the screenshot seam", async () => {
    const onScreenshot = vi.fn();
    const view = render(
      <ViewerPane
        colors={colors}
        maximized={false}
        narrow={false}
        renderStatus="success"
        result={threeD}
        viewer={{
          camera: {
            projection: "perspective",
            position: [28, 24, 28],
            target: [0, 0, 0],
            up: [0, 0, 1],
            zoom: 1,
          },
          furniture: { grid: true, axes: true, edges: false, shadow: false },
          measurements: [],
          annotations: [],
        }}
        onLayoutAction={vi.fn()}
        onScreenshot={onScreenshot}
        onViewerAction={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Capture viewport as PNG" }));

    await waitFor(() => expect(onScreenshot).toHaveBeenCalledWith(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ));
    expect(view.getByText(/scene-only png captured/i)).toBeVisible();
  });

  it("routes viewer-scoped Appendix D camera shortcuts while the viewer is focused", () => {
    const onViewerAction = vi.fn();
    const view = render(
      <ViewerPane
        colors={colors}
        keybindings={DEFAULT_KEYBINDINGS}
        maximized={false}
        narrow={false}
        renderStatus="success"
        result={threeD}
        viewer={{
          camera: {
            projection: "perspective",
            position: [28, 24, 28],
            target: [0, 0, 0],
            up: [0, 0, 1],
            zoom: 1,
          },
          furniture: { grid: true, axes: true, edges: false, shadow: false },
          measurements: [],
          annotations: [],
        }}
        onLayoutAction={vi.fn()}
        onViewerAction={onViewerAction}
      />,
    );
    const viewport = view.getByTestId("model-viewer");
    viewport.focus();
    const top = new KeyboardEvent("keydown", {
      code: "Numpad7",
      key: "Home",
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(top);

    expect(top.defaultPrevented).toBe(true);
    expect(onViewerAction).toHaveBeenCalledWith(expect.objectContaining({
      kind: "set-camera",
      camera: expect.objectContaining({ target: [5, 5, 5], position: [5, 5, 27] }),
    }));
  });
});
