// @vitest-environment happy-dom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDefaultViewerCamera } from "../../../src/application/viewer/viewer-state";
import { ViewerToolbar } from "../../../src/ui/viewer/ViewerToolbar";

describe("ViewerToolbar", () => {
  it("routes axis, fit, projection, reset, furniture, tools, and screenshot controls", () => {
    const onCameraChange = vi.fn();
    const onFurnitureChange = vi.fn();
    const onToolChange = vi.fn();
    const onScreenshot = vi.fn();
    const camera = createDefaultViewerCamera();
    const view = render(
      <ViewerToolbar
        bounds={{ min: [0, 0, 0], max: [10, 10, 10] }}
        camera={camera}
        furniture={{ grid: true, axes: true, edges: false, shadow: false }}
        tool="navigate"
        onCameraChange={onCameraChange}
        onFurnitureChange={onFurnitureChange}
        onScreenshot={onScreenshot}
        onToolChange={onToolChange}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Top view" }));
    expect(onCameraChange).toHaveBeenLastCalledWith(expect.objectContaining({
      position: [5, 5, 27],
      target: [5, 5, 5],
    }));
    fireEvent.click(view.getByRole("button", { name: "Fit model" }));
    fireEvent.click(view.getByRole("button", { name: "Use orthographic projection" }));
    fireEvent.click(view.getByRole("button", { name: "Reset view" }));
    expect(onCameraChange).toHaveBeenCalledTimes(4);

    fireEvent.click(view.getByRole("checkbox", { name: "Show edge overlay" }));
    expect(onFurnitureChange).toHaveBeenCalledWith("edges", true);
    fireEvent.click(view.getByRole("button", { name: "Measure point-to-point distance" }));
    expect(onToolChange).toHaveBeenCalledWith("measure");
    fireEvent.click(view.getByRole("button", { name: "Capture viewport as PNG" }));
    expect(onScreenshot).toHaveBeenCalledOnce();
  });

  it("disables geometry-dependent views until model bounds are available", () => {
    const view = render(
      <ViewerToolbar
        camera={createDefaultViewerCamera()}
        furniture={{ grid: true, axes: true, edges: false, shadow: false }}
        tool="navigate"
        onCameraChange={vi.fn()}
        onFurnitureChange={vi.fn()}
        onScreenshot={vi.fn()}
        onToolChange={vi.fn()}
      />,
    );
    expect(view.getByRole("button", { name: "Top view" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Fit model" })).toBeDisabled();
  });

  it("resets position without overriding the settings-owned projection", () => {
    const onCameraChange = vi.fn();
    const camera = { ...createDefaultViewerCamera(), projection: "orthographic" as const };
    const view = render(
      <ViewerToolbar
        camera={camera}
        furniture={{ grid: true, axes: true, edges: false, shadow: false }}
        tool="navigate"
        onCameraChange={onCameraChange}
        onFurnitureChange={vi.fn()}
        onScreenshot={vi.fn()}
        onToolChange={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Reset view" }));

    expect(onCameraChange).toHaveBeenCalledWith(expect.objectContaining({
      projection: "orthographic",
      position: [28, 24, 28],
    }));
  });
});
