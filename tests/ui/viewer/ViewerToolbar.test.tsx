// @vitest-environment happy-dom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDefaultViewerCamera } from "../../../src/application/viewer/viewer-state";
import { ViewerToolbar } from "../../../src/ui/viewer/ViewerToolbar";

describe("ViewerToolbar", () => {
  it("routes axis, fit, projection, reset, furniture, tools, and screenshot controls", () => {
    const onCameraChange = vi.fn();
    const onFurnitureChange = vi.fn();
    const onClippingChange = vi.fn();
    const onToolChange = vi.fn();
    const onScreenshot = vi.fn();
    const camera = createDefaultViewerCamera();
    const view = render(
      <ViewerToolbar
        bounds={{ min: [0, 0, 0], max: [10, 10, 10] }}
        camera={camera}
        clipping={{ enabled: false, axis: "x", offset: 0 }}
        furniture={{ grid: true, axes: true, edges: false, shadow: false }}
        tool="navigate"
        onCameraChange={onCameraChange}
        onClippingChange={onClippingChange}
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

    fireEvent.click(view.getByRole("checkbox", { name: "Enable section view" }));
    expect(onClippingChange).toHaveBeenLastCalledWith({ enabled: true, axis: "x", offset: 0 });
    fireEvent.change(view.getByRole("combobox", { name: "Section axis" }), { target: { value: "z" } });
    expect(onClippingChange).toHaveBeenLastCalledWith({ enabled: false, axis: "z", offset: 5 });
    fireEvent.change(view.getByRole("slider", { name: "Section position" }), { target: { value: "7.5" } });
    expect(onClippingChange).toHaveBeenLastCalledWith({ enabled: false, axis: "x", offset: 7.5 });
  });

  it("disables geometry-dependent views until model bounds are available", () => {
    const view = render(
      <ViewerToolbar
        camera={createDefaultViewerCamera()}
        clipping={{ enabled: false, axis: "x", offset: 0 }}
        furniture={{ grid: true, axes: true, edges: false, shadow: false }}
        tool="navigate"
        onCameraChange={vi.fn()}
        onClippingChange={vi.fn()}
        onFurnitureChange={vi.fn()}
        onScreenshot={vi.fn()}
        onToolChange={vi.fn()}
      />,
    );
    expect(view.getByRole("button", { name: "Top view" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Fit model" })).toBeDisabled();
    expect(view.getByRole("checkbox", { name: "Enable section view" })).toBeDisabled();
  });

  it("resets position without overriding the settings-owned projection", () => {
    const onCameraChange = vi.fn();
    const camera = { ...createDefaultViewerCamera(), projection: "orthographic" as const };
    const view = render(
      <ViewerToolbar
        camera={camera}
        clipping={{ enabled: false, axis: "x", offset: 0 }}
        furniture={{ grid: true, axes: true, edges: false, shadow: false }}
        tool="navigate"
        onCameraChange={onCameraChange}
        onClippingChange={vi.fn()}
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

  it("locks projection and furniture settings without disabling transient camera tools", () => {
    const onCameraChange = vi.fn();
    const onFurnitureChange = vi.fn();
    const view = render(
      <ViewerToolbar
        bounds={{ min: [0, 0, 0], max: [10, 10, 10] }}
        camera={createDefaultViewerCamera()}
        clipping={{ enabled: false, axis: "x", offset: 0 }}
        furniture={{ grid: true, axes: true, edges: false, shadow: false }}
        settingsDisabled
        tool="navigate"
        onCameraChange={onCameraChange}
        onClippingChange={vi.fn()}
        onFurnitureChange={onFurnitureChange}
        onScreenshot={vi.fn()}
        onToolChange={vi.fn()}
      />,
    );

    expect(view.getByRole("button", { name: "Use orthographic projection" })).toBeDisabled();
    for (const name of ["Show XY grid", "Show RGB axes", "Show edge overlay", "Show ground shadow"]) {
      expect(view.getByRole("checkbox", { name })).toBeDisabled();
    }
    expect(view.getByRole("button", { name: "Top view" })).toBeEnabled();
    expect(view.getByRole("button", { name: "Fit model" })).toBeEnabled();

    fireEvent.click(view.getByRole("button", { name: "Use orthographic projection" }));
    fireEvent.click(view.getByRole("checkbox", { name: "Show edge overlay" }));
    expect(onCameraChange).not.toHaveBeenCalled();
    expect(onFurnitureChange).not.toHaveBeenCalled();
  });
});
