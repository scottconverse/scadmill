// @vitest-environment happy-dom
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createDocumentWorkspace,
  reduceDocumentWorkspace,
} from "../../../src/application/documents/document-workspace";
import { messages } from "../../../src/messages/en";
import { DocumentTabBar } from "../../../src/ui/editor/DocumentTabBar";

const seeds = [
  { id: "document-main", path: "main.scad", source: "cube(10);" },
  { id: "document-wheel", path: "parts/wheel.scad", source: "cylinder(r = 4, h = 2);" },
] as const;

describe("DocumentTabBar", () => {
  it("exposes selected tabs, filenames, and an accessible dirty marker", () => {
    const initial = createDocumentWorkspace(seeds, "document-main");
    const workspace = reduceDocumentWorkspace(initial, {
      kind: "edit",
      documentId: "document-wheel",
      source: "cylinder(r = 5, h = 2);",
    });

    const view = render(
      <DocumentTabBar
        workspace={workspace}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    const tabs = within(view.container);
    expect(tabs.getByRole("tablist", { name: messages.openDocuments })).toBeVisible();
    expect(tabs.getByRole("tab", { name: "main.scad" })).toHaveAttribute("aria-selected", "true");
    expect(
      tabs.getByRole("tab", { name: messages.documentTabUnsaved("wheel.scad") }),
    ).toHaveAttribute("aria-selected", "false");
    expect(tabs.getByRole("status")).toHaveTextContent(
      messages.documentUnsavedStatus("wheel.scad"),
    );
    expect(
      tabs.getByRole("button", { name: messages.closeDirtyDocument("wheel.scad") }),
    ).toBeDisabled();
  });

  it("activates with pointer and keyboard while keeping a roving tab stop", () => {
    const onActivate = vi.fn();
    const view = render(
      <DocumentTabBar
        workspace={createDocumentWorkspace(seeds, "document-main")}
        onActivate={onActivate}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    const tabs = within(view.container);
    const main = tabs.getByRole("tab", { name: "main.scad" });
    const wheel = tabs.getByRole("tab", { name: "wheel.scad" });

    expect(main).toHaveAttribute("tabindex", "0");
    expect(wheel).toHaveAttribute("tabindex", "-1");
    fireEvent.click(wheel);
    expect(onActivate).toHaveBeenLastCalledWith("document-wheel");

    main.focus();
    fireEvent.keyDown(main, { key: "ArrowRight" });
    expect(onActivate).toHaveBeenLastCalledWith("document-wheel");
    expect(wheel).toHaveFocus();
  });

  it("routes close buttons, middle-click, drag reorder, and keyboard reorder", () => {
    const onClose = vi.fn();
    const onMove = vi.fn();
    const view = render(
      <DocumentTabBar
        workspace={createDocumentWorkspace(seeds, "document-main")}
        onActivate={vi.fn()}
        onClose={onClose}
        onMove={onMove}
      />,
    );
    const tabs = within(view.container);
    const main = tabs.getByRole("tab", { name: "main.scad" });
    const wheel = tabs.getByRole("tab", { name: "wheel.scad" });

    fireEvent.click(tabs.getByRole("button", { name: messages.closeDocument("wheel.scad") }));
    expect(onClose).toHaveBeenLastCalledWith("document-wheel");

    fireEvent(main, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenLastCalledWith("document-main");

    fireEvent.dragStart(main);
    fireEvent.dragOver(wheel);
    fireEvent.drop(wheel);
    expect(onMove).toHaveBeenLastCalledWith("document-main", 1);

    fireEvent.keyDown(main, { key: "ArrowRight", altKey: true, shiftKey: true });
    expect(onMove).toHaveBeenLastCalledWith("document-main", 1);
  });

  it("disambiguates duplicate filenames with project-relative accessible labels", () => {
    const view = render(
      <DocumentTabBar
        workspace={createDocumentWorkspace([
          { id: "document-left", path: "left/main.scad", source: "cube(1);" },
          { id: "document-right", path: "right/main.scad", source: "cube(2);" },
        ], "document-left")}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    const tabs = within(view.container);

    expect(tabs.getByRole("tab", { name: "left/main.scad" })).toBeVisible();
    expect(tabs.getByRole("tab", { name: "right/main.scad" })).toBeVisible();
    expect(tabs.getAllByText("main.scad")).toHaveLength(2);
    expect(
      tabs.getByRole("button", { name: messages.closeDocument("right/main.scad") }),
    ).toBeEnabled();
  });

  it("names every live dirty announcement when multiple documents are unsaved", () => {
    let workspace = createDocumentWorkspace(seeds, "document-main");
    workspace = reduceDocumentWorkspace(workspace, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(11);",
    });
    workspace = reduceDocumentWorkspace(workspace, {
      kind: "edit",
      documentId: "document-wheel",
      source: "cylinder(r = 5, h = 2);",
    });
    const view = render(
      <DocumentTabBar
        workspace={workspace}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    expect(within(view.container).getAllByRole("status").map((status) => status.textContent)).toEqual([
      messages.documentUnsavedStatus("main.scad"),
      messages.documentUnsavedStatus("wheel.scad"),
    ]);
  });
});
