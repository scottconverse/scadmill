// @vitest-environment happy-dom
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderSuccess2D } from "../../../src/application/engine/contracts";
import { SvgViewer } from "../../../src/ui/viewer/SvgViewer";

const result: RenderSuccess2D = {
  kind: "2d",
  geometryIdentity: `sha256:${"9".repeat(64)}`,
  svg: `<svg width="32mm" height="22mm" viewBox="-1 -21 32 22" xmlns="http://www.w3.org/2000/svg" version="1.1"><title>OpenSCAD Model</title><path d="M0,0 L30,0 L30,-20 L0,-20 z" stroke="black" fill="none" stroke-width="0.35"/></svg>`,
  boundingBox: { min: [0, 0], max: [30, 20] },
  diagnostics: [],
  rawLog: "rendered",
};

describe("SvgViewer", () => {
  const presentationToken = "svg-presentation";
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          this.callback(
            [{ contentRect: { width: 600, height: 400 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        disconnect() {}
        unobserve() {}
      },
    );
  });

  it("renders sanitized engine SVG with exact model dimensions and scale", () => {
    const view = render(<SvgViewer result={result} />);
    const image = view.getByRole("img", { name: "2D OpenSCAD drawing" });

    expect(image).toHaveAttribute("src", expect.stringMatching(/^data:image\/svg\+xml/));
    expect(view.getByText("30 × 20 mm")).toBeVisible();
    expect(view.getByText(/mm\/px$/)).toBeVisible();
    expect(view.getByRole("button", { name: "Fit drawing" })).toBeEnabled();
  });

  it("reports presentation readiness only when the sanitized drawing image loads", () => {
    const onPresentationReady = vi.fn();
    render(<SvgViewer result={result} onPresentationReady={onPresentationReady} presentationToken={presentationToken} />);

    expect(onPresentationReady).toHaveBeenCalledOnce();
    expect(onPresentationReady).toHaveBeenCalledWith(presentationToken);
  });

  it("zooms at the pointer and restores fit", () => {
    const view = render(<SvgViewer result={result} />);
    const viewport = view.getByRole("button", { name: "2D drawing viewer" });
    const initialScale = view.getByTestId("svg-scale").textContent;

    fireEvent.wheel(viewport, { clientX: 430, clientY: 115, deltaY: -100 });
    expect(view.getByTestId("svg-scale").textContent).not.toBe(initialScale);

    fireEvent.click(view.getByRole("button", { name: "Fit drawing" }));
    expect(view.getByTestId("svg-scale").textContent).toBe(initialScale);
  });

  it("fails closed when engine SVG contains active content", () => {
    const unsafe = { ...result, svg: `<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>` };
    const onPresentationFailed = vi.fn();
    const view = render(
      <SvgViewer
        onPresentationFailed={onPresentationFailed}
        presentationToken={presentationToken}
        result={unsafe}
      />,
    );

    expect(view.queryByRole("img")).not.toBeInTheDocument();
    expect(view.getByRole("alert")).toHaveTextContent("The 2D engine output could not be displayed safely.");
    expect(onPresentationFailed).toHaveBeenCalledWith(presentationToken);
  });

  it("reports a sanitized drawing that the image element cannot load", () => {
    const onPresentationFailed = vi.fn();
    const view = render(
      <SvgViewer
        onPresentationFailed={onPresentationFailed}
        presentationToken={presentationToken}
        result={result}
      />,
    );

    fireEvent.error(view.getByRole("img", { name: "2D OpenSCAD drawing" }));

    expect(onPresentationFailed).toHaveBeenCalledWith(presentationToken);
  });
});
