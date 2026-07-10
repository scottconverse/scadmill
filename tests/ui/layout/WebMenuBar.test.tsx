// @vitest-environment happy-dom
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_WORKSPACE_LAYOUT } from "../../../src/application/layout/workspace-layout";
import { WebMenuBar } from "../../../src/ui/layout/WebMenuBar";

describe("WebMenuBar", () => {
  it("offers honest web menus and routes working commands through callbacks", () => {
    const onLayoutAction = vi.fn();
    const onRenderPreview = vi.fn();
    const view = render(
      <WebMenuBar
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        renderDisabled={false}
        onLayoutAction={onLayoutAction}
        onRenderPreview={onRenderPreview}
      />,
    );
    const menu = within(view.container);

    expect(menu.getByRole("navigation", { name: "Application menu" })).toBeVisible();
    expect(menu.getByRole("button", { name: "File" })).toBeDisabled();
    expect(menu.getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(menu.getByRole("button", { name: "Help" })).toBeDisabled();

    const openView = () => fireEvent.click(menu.getByText("View"));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Toggle left dock" }));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Toggle parameter panel" }));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Maximize editor" }));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Reset layout" }));

    expect(onLayoutAction.mock.calls).toEqual([
      [{ kind: "toggle-panel", panel: "dock" }],
      [{ kind: "toggle-panel", panel: "parameter" }],
      [{ kind: "toggle-maximize", region: "editor" }],
      [{ kind: "reset-layout" }],
    ]);

    fireEvent.click(menu.getByText("Render"));
    fireEvent.click(menu.getByRole("button", { name: "Render preview" }));
    expect(onRenderPreview).toHaveBeenCalledTimes(1);
  });

  it("routes narrow menu commands to visible overlays, sheets, and primary views", () => {
    const onLayoutAction = vi.fn();
    const view = render(
      <WebMenuBar
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={true}
        renderDisabled={true}
        onLayoutAction={onLayoutAction}
        onRenderPreview={vi.fn()}
      />,
    );
    const menu = within(view.container);

    const openView = () => fireEvent.click(menu.getByText("View"));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Toggle left dock" }));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Show model" }));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Toggle parameter panel" }));
    openView();
    fireEvent.click(menu.getByRole("button", { name: "Toggle console" }));

    expect(onLayoutAction.mock.calls).toEqual([
      [{ kind: "activate-rail", panel: "files", narrow: true }],
      [{ kind: "set-narrow-view", view: "model" }],
      [{ kind: "set-narrow-sheet", sheet: "parameter" }],
      [{ kind: "set-narrow-sheet", sheet: "console" }],
    ]);
    expect(menu.queryByRole("button", { name: "Maximize editor" })).not.toBeInTheDocument();
    expect(menu.queryByRole("button", { name: "Maximize viewer" })).not.toBeInTheDocument();
  });

  it("keeps only one menu open and dismisses it after commands or Escape", () => {
    const view = render(
      <WebMenuBar
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        renderDisabled={false}
        onLayoutAction={vi.fn()}
        onRenderPreview={vi.fn()}
      />,
    );
    const menu = within(view.container);

    const viewTrigger = menu.getByRole("button", { name: "View" });
    const renderTrigger = menu.getByRole("button", { name: "Render" });
    expect(viewTrigger).not.toHaveAttribute("aria-haspopup");
    expect(renderTrigger).not.toHaveAttribute("aria-haspopup");

    fireEvent.click(viewTrigger);
    const dockCommand = menu.getByRole("button", { name: "Toggle left dock" });
    dockCommand.focus();
    fireEvent.click(dockCommand);
    expect(view.container.querySelectorAll('[data-menu-open="true"]')).toHaveLength(0);
    expect(viewTrigger).toHaveFocus();

    fireEvent.click(viewTrigger);
    fireEvent.click(renderTrigger);
    expect(view.container.querySelectorAll('[data-menu-open="true"]')).toHaveLength(1);

    const previewCommand = menu.getByRole("button", { name: "Render preview" });
    previewCommand.focus();
    fireEvent.keyDown(previewCommand, { key: "Escape" });
    expect(view.container.querySelectorAll('[data-menu-open="true"]')).toHaveLength(0);
    expect(renderTrigger).toHaveFocus();

    viewTrigger.focus();
    fireEvent.keyDown(menu.getByRole("navigation", { name: "Application menu" }), {
      key: "Escape",
    });
    expect(viewTrigger).toHaveFocus();
  });
});
