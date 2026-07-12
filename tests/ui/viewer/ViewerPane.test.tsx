// @vitest-environment happy-dom
import { forwardRef, startTransition, Suspense, useImperativeHandle } from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RenderResult } from "../../../src/application/engine/contracts";
import type { ViewerMode } from "../../../src/application/viewer/viewer-state";
import { DEFAULT_KEYBINDINGS } from "../../../src/application/commands/default-keybindings";
import { ViewerPane } from "../../../src/ui/viewer/ViewerPane";

vi.mock("../../../src/ui/viewer/ModelViewer", () => ({
  ModelViewer: forwardRef(({ dimmed, emptyMessage, onPointPick }: {
    dimmed?: boolean;
    emptyMessage?: string;
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
      >3D{emptyMessage && <span>{emptyMessage}</span>}</button>
    );
  }),
}));

vi.mock("../../../src/ui/viewer/SvgViewer", () => ({
  SvgViewer: () => <div data-testid="svg-viewer">2D</div>,
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

const twoD: RenderResult = {
  kind: "2d",
  svg: `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`,
  boundingBox: { min: [0, 0], max: [10, 10] },
  diagnostics: [],
  rawLog: "",
};

const threeD: RenderResult = {
  kind: "3d",
  mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
  stats: { boundingBox: { min: [0, 0, 0], max: [10, 10, 10] }, engineTimeMs: 1 },
  diagnostics: [],
  rawLog: "",
};

function Harness({ result }: { result?: RenderResult }) {
  let mode: ViewerMode = "auto";
  return (
    <ViewerPane
      colors={colors}
      maximized={false}
      mode={mode}
      narrow={false}
      renderStatus="success"
      result={result}
      onLayoutAction={vi.fn()}
      onModeChange={(next) => { mode = next; }}
    />
  );
}

describe("ViewerPane result routing", () => {
  it("restarts elapsed render time when a rendering job is superseded", () => {
    vi.useFakeTimers();
    let view: ReturnType<typeof render> | undefined;
    try {
      const common = {
        colors,
        maximized: false,
        narrow: false,
        renderStatus: "rendering" as const,
        onLayoutAction: vi.fn(),
      };
      view = render(<ViewerPane {...common} renderJobId="job-a" />);

      act(() => vi.advanceTimersByTime(1_200));
      expect(view.getByRole("status", { name: "Render progress" }))
        .toHaveTextContent("Rendering… 1.2 s");

      view.rerender(<ViewerPane {...common} renderJobId="job-b" />);
      expect(view.getByRole("status", { name: "Render progress" }))
        .toHaveTextContent("Rendering… 0.0 s");

      act(() => vi.advanceTimersByTime(200));
      expect(view.getByRole("status", { name: "Render progress" }))
        .toHaveTextContent("Rendering… 0.2 s");
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps the committed render timer running while a superseding render is suspended", () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => undefined);
    function Blocker({ active }: { readonly active: boolean }) {
      if (active) throw never;
      return null;
    }
    const common = {
      colors,
      maximized: false,
      narrow: false,
      renderStatus: "rendering" as const,
      onLayoutAction: vi.fn(),
    };
    const tree = (jobId: string, block: boolean) => (
      <Suspense fallback={<p>Outer fallback</p>}>
        <ViewerPane {...common} renderJobId={jobId} />
        <Blocker active={block} />
      </Suspense>
    );
    const view = render(tree("job-a", false));
    try {
      act(() => vi.advanceTimersByTime(300));
      expect(view.getByRole("status", { name: "Render progress" }))
        .toHaveTextContent("Rendering… 0.3 s");

      act(() => startTransition(() => view.rerender(tree("job-b", true))));
      expect(view.queryByText("Outer fallback")).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(400));
      expect(view.getByRole("status", { name: "Render progress" }))
        .toHaveTextContent("Rendering… 0.7 s");
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("keeps annotation persistence failures visible with retry and exact-JSON recovery actions", () => {
    const retry = vi.fn();
    const exportMetadata = vi.fn();
    const common = {
      colors,
      maximized: false,
      narrow: false,
      renderStatus: "idle" as const,
      onLayoutAction: vi.fn(),
      onRetryAnnotationPersistence: retry,
      onExportAnnotationMetadata: exportMetadata,
    };
    const view = render(
      <ViewerPane {...common} annotationPersistence={{ status: "unsaved" }} />,
    );

    const alert = view.getByRole("alert");
    expect(alert).toHaveTextContent(/annotation changes are not saved/iu);
    expect(alert).toHaveTextContent(/closing ScadMill may lose them/iu);
    fireEvent.click(view.getByRole("button", { name: "Retry saving annotations" }));
    fireEvent.click(view.getByRole("button", { name: "Export current annotations as JSON" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(exportMetadata).toHaveBeenCalledOnce();
    expect(view.getByRole("alert")).toBeVisible();

    view.rerender(
      <ViewerPane {...common} annotationPersistence={{ status: "load-error" }} />,
    );
    expect(view.getByRole("alert")).toHaveTextContent(/saved annotation metadata could not be loaded/iu);
    expect(view.getByRole("button", { name: "Retry loading annotations" })).toBeVisible();

    view.rerender(
      <ViewerPane {...common} annotationPersistence={{ status: "load-error-unsaved" }} />,
    );
    expect(view.getByRole("alert")).toHaveTextContent(/could not be loaded/iu);
    expect(view.getByRole("alert")).toHaveTextContent(/new annotation changes are not saved/iu);
    expect(view.getByRole("button", { name: "Retry saving annotations" })).toBeVisible();

    view.rerender(
      <ViewerPane {...common} annotationPersistence={{ status: "saved" }} />,
    );
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers an available next step when rendering is unavailable", async () => {
    const props = {
      colors,
      engineAvailable: false,
      maximized: false,
      narrow: false,
      renderStatus: "idle" as const,
      onLayoutAction: vi.fn(),
    };

    const view = render(<ViewerPane {...props} />);

    expect(await view.findByText(
      "OpenSCAD is unavailable. Keep editing, or configure the engine to render this model.",
    )).toBeVisible();
    expect(view.queryByText("Render the source to inspect the model.")).not.toBeInTheDocument();
  });

  it("switches automatically between 2D and 3D from the engine discriminator", async () => {
    const view = render(<Harness result={twoD} />);
    expect(await view.findByTestId("svg-viewer")).toBeVisible();
    expect(view.queryByTestId("model-viewer")).not.toBeInTheDocument();

    view.rerender(<Harness result={threeD} />);
    expect(await view.findByTestId("model-viewer")).toBeVisible();
    expect(view.queryByTestId("svg-viewer")).not.toBeInTheDocument();
  });

  it("reports an incompatible pinned mode without showing stale geometry", () => {
    const onModeChange = vi.fn();
    const view = render(
      <ViewerPane
        colors={colors}
        maximized={false}
        mode="3d"
        narrow={false}
        renderStatus="success"
        result={twoD}
        onLayoutAction={vi.fn()}
        onModeChange={onModeChange}
      />,
    );

    expect(view.queryByTestId("svg-viewer")).not.toBeInTheDocument();
    expect(view.queryByTestId("model-viewer")).not.toBeInTheDocument();
    expect(view.getByRole("status")).toHaveTextContent(/pinned 3D mode/i);
    fireEvent.change(view.getByLabelText("Viewer mode"), { target: { value: "auto" } });
    expect(onModeChange).toHaveBeenCalledWith("auto");
  });

  it("keeps last-good geometry dimmed while rendering and exposes cancel", async () => {
    const onCancel = vi.fn();
    const view = render(
      <ViewerPane
        colors={colors}
        dimmed
        maximized={false}
        mode="auto"
        narrow={false}
        renderStatus="rendering"
        result={threeD}
        onCancel={onCancel}
        onLayoutAction={vi.fn()}
        onModeChange={vi.fn()}
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
        mode="auto"
        narrow={false}
        renderStatus="failure"
        result={threeD}
        onLayoutAction={vi.fn()}
        onModeChange={vi.fn()}
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
        mode="auto"
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
          mode: "auto",
          furniture: { grid: true, axes: true, edges: false, shadow: false },
          measurements: [],
          annotations: [],
        }}
        onLayoutAction={vi.fn()}
        onModeChange={vi.fn()}
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
      mode: "auto" as const,
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
        mode: "auto" as const,
        modelIdentity: "shared-model-identity",
        furniture: { grid: true, axes: true, edges: false, shadow: false },
        measurements: [],
        annotations: [],
      },
      onLayoutAction: vi.fn(),
      onModeChange: vi.fn(),
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
        mode="auto"
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
          mode: "auto",
          furniture: { grid: true, axes: true, edges: false, shadow: false },
          measurements: [],
          annotations: [],
        }}
        onLayoutAction={vi.fn()}
        onModeChange={vi.fn()}
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
        mode="auto"
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
          mode: "auto",
          furniture: { grid: true, axes: true, edges: false, shadow: false },
          measurements: [],
          annotations: [],
        }}
        onLayoutAction={vi.fn()}
        onModeChange={vi.fn()}
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
