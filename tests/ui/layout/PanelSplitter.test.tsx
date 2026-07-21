// @vitest-environment happy-dom
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PanelSplitter } from "../../../src/ui/layout/PanelSplitter";

function renderSplitter(onCommit = vi.fn(), onPreview = vi.fn()) {
  const view = render(
    <PanelSplitter
      label="Resize files panel"
      orientation="vertical"
      value={260}
      minimum={180}
      maximum={480}
      growthDirection={1}
      onCommit={onCommit}
      onPreview={onPreview}
    />,
  );
  return { ...view, onCommit, onPreview };
}

describe("PanelSplitter", () => {
  it("exposes separator value metadata and commits bounded keyboard steps", () => {
    const { container, onCommit } = renderSplitter();
    const splitter = within(container).getByRole("separator", { name: "Resize files panel" });

    expect(splitter).toHaveAttribute("aria-orientation", "vertical");
    expect(splitter).toHaveAttribute("aria-valuemin", "180");
    expect(splitter).toHaveAttribute("aria-valuemax", "480");
    expect(splitter).toHaveAttribute("aria-valuenow", "260");

    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    fireEvent.keyDown(splitter, { key: "Home" });
    fireEvent.keyDown(splitter, { key: "End" });
    fireEvent.keyDown(splitter, { key: "ArrowUp" });

    expect(onCommit.mock.calls).toEqual([[268], [180], [480]]);
  });

  it("previews a pointer drag locally and commits once on release", () => {
    const { container, onCommit, onPreview } = renderSplitter();
    const splitter = within(container).getByRole("separator", { name: "Resize files panel" });

    fireEvent.pointerDown(splitter, { pointerId: 7, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(splitter, { pointerId: 7, clientX: 140, clientY: 20 });
    expect(splitter).toHaveAttribute("aria-valuenow", "300");
    expect(onPreview).toHaveBeenLastCalledWith(300);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(splitter, { pointerId: 7, clientX: 140, clientY: 20 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(300);
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it("reverses physical motion for panels that grow toward the start edge", () => {
    const onCommit = vi.fn();
    const view = render(
      <PanelSplitter
        label="Resize viewer column"
        orientation="vertical"
        value={480}
        minimum={320}
        maximum={720}
        growthDirection={-1}
        onCommit={onCommit}
      />,
    );
    const splitter = within(view.container).getByRole("separator", {
      name: "Resize viewer column",
    });

    fireEvent.pointerDown(splitter, { pointerId: 8, clientX: 600 });
    fireEvent.pointerMove(splitter, { pointerId: 8, clientX: 560 });
    fireEvent.pointerUp(splitter, { pointerId: 8, clientX: 560 });

    expect(onCommit).toHaveBeenCalledWith(520);
  });
});
