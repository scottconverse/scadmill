// @vitest-environment happy-dom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ViewerDetailsPanel } from "../../../src/ui/viewer/ViewerDetailsPanel";

describe("ViewerDetailsPanel", () => {
  it("lists exact point distances and persistent annotations with individual delete actions", () => {
    const deleteMeasurement = vi.fn();
    const deleteAnnotation = vi.fn();
    const view = render(
      <ViewerDetailsPanel
        annotations={[{ id: "note", point: [2, 3, 4], text: "Hole center" }]}
        annotationDraft=""
        measurements={[{ id: "measure", start: [0, 0, 0], end: [10, 10, 10] }]}
        onAnnotationDraftChange={vi.fn()}
        onDeleteAnnotation={deleteAnnotation}
        onDeleteMeasurement={deleteMeasurement}
      />,
    );

    expect(view.getByText("17.3205 mm")).toBeVisible();
    expect(view.getByText("Hole center")).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Delete measurement 17.3205 mm" }));
    fireEvent.click(view.getByRole("button", { name: "Delete annotation Hole center" }));
    expect(deleteMeasurement).toHaveBeenCalledWith("measure");
    expect(deleteAnnotation).toHaveBeenCalledWith("note");
  });

  it("accepts a plain-text annotation draft and explains the next model click", () => {
    const onDraft = vi.fn();
    const view = render(
      <ViewerDetailsPanel
        annotations={[]}
        annotationDraft="new note"
        measurements={[]}
        onAnnotationDraftChange={onDraft}
        onDeleteAnnotation={vi.fn()}
        onDeleteMeasurement={vi.fn()}
      />,
    );

    const input = view.getByLabelText("Annotation text");
    fireEvent.change(input, { target: { value: "Datum A" } });
    expect(onDraft).toHaveBeenCalledWith("Datum A");
    expect(view.getByText(/choose the annotation tool, then select a point/i)).toBeVisible();
  });
});
