// @vitest-environment happy-dom
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDocumentWorkspace } from "../../../src/application/documents/document-workspace";
import { EditorGroupsPane } from "../../../src/ui/editor/EditorGroupsPane";

describe("EditorGroupsPane", () => {
  it("splits, changes orientation, moves a tab across groups, and focuses its render target", () => {
    const workspace = createDocumentWorkspace([
      { id: "main", path: "main.scad", source: "cube(1);" },
      { id: "wheel", path: "wheel.scad", source: "cylinder(1);" },
    ], "wheel");
    const onActivate = vi.fn();
    const view = render(
      <EditorGroupsPane
        maximized={false}
        narrow={false}
        onActivate={onActivate}
        onClose={vi.fn()}
        onMoveDocument={vi.fn()}
        onToggleMaximize={vi.fn()}
        onTogglePanel={vi.fn()}
        renderEditor={(document) => <div>{document.source}</div>}
        workspace={workspace}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Split editor" }));
    const primary = view.getByRole("region", { name: "Primary editor group" });
    const secondary = view.getByRole("region", { name: "Secondary editor group" });
    expect(within(primary).getByRole("tab", { name: "main.scad" })).toBeVisible();
    expect(within(secondary).getByRole("tab", { name: "wheel.scad" })).toBeVisible();

    fireEvent.click(view.getByRole("button", { name: "Stack editors" }));
    expect(view.container.querySelector(".editor-groups")).toHaveAttribute("data-orientation", "vertical");

    let transferred = "";
    const transfer = {
      setData(_type: string, value: string) { transferred = value; },
      getData() { return transferred; },
      effectAllowed: "none",
      dropEffect: "none",
    };
    fireEvent.dragStart(within(primary).getByRole("tab", { name: "main.scad" }), { dataTransfer: transfer });
    fireEvent.drop(within(secondary).getByRole("tablist"), { dataTransfer: transfer });
    expect(within(secondary).getByRole("tab", { name: "main.scad" })).toBeVisible();
    expect(onActivate).toHaveBeenLastCalledWith("main");
  });
});
