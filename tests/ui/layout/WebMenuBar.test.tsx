// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_KEYBINDINGS } from "../../../src/application/commands/default-keybindings";
import { DEFAULT_WORKSPACE_LAYOUT } from "../../../src/application/layout/workspace-layout";
import { WebMenuBar } from "../../../src/ui/layout/WebMenuBar";

describe("WebMenuBar", () => {
  it("offers honest web menus and routes working commands through callbacks", () => {
    const onLayoutAction = vi.fn();
    const onRenderPreview = vi.fn();
    const onCloseDocument = vi.fn();
    const onReopenDocument = vi.fn();
    const onEditorCommand = vi.fn();
    const onOpenRecentProject = vi.fn();
    const onSaveDocument = vi.fn();
    const onSaveAllDocuments = vi.fn();
    const onNewFile = vi.fn();
    const onOpenProject = vi.fn();
    const onExport = vi.fn();
    const view = render(
      <WebMenuBar
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        renderDisabled={false}
        onLayoutAction={onLayoutAction}
        onRenderFull={vi.fn()}
        onRenderPreview={onRenderPreview}
        closeDocumentDisabled={false}
        reopenDocumentDisabled={false}
        onCloseDocument={onCloseDocument}
        onReopenDocument={onReopenDocument}
        onEditorCommand={onEditorCommand}
        onOpenRecentProject={onOpenRecentProject}
        recentProjects={[{
          projectId: "project-a",
          displayName: "Cube project",
          openedAt: "2026-07-10T00:00:00.000Z",
        }]}
        onSaveDocument={onSaveDocument}
        onSaveAllDocuments={onSaveAllDocuments}
        onNewFile={onNewFile}
        onOpenProject={onOpenProject}
        onExport={onExport}
      />,
    );
    const menu = within(view.container);

    expect(menu.getByRole("navigation", { name: "Application menu" })).toBeVisible();
    expect(menu.getByRole("button", { name: "File" })).toBeEnabled();
    expect(menu.getByRole("button", { name: "Edit" })).toBeEnabled();
    const help = menu.getByRole("button", { name: "Help" });
    expect(help).toBeEnabled();
    help.focus();
    expect(help).toHaveFocus();
    fireEvent.click(help);
    expect(menu.getByRole("status", { name: "Help information" })).toHaveTextContent(
      "Find every command in the menus, or open Settings to review and customize keyboard shortcuts.",
    );

    const openFile = () => fireEvent.click(menu.getByText("File"));
    openFile();
    for (const [name, callback] of [
      ["Save", onSaveDocument],
      ["Save all", onSaveAllDocuments],
      ["New file", onNewFile],
      ["Open project", onOpenProject],
      ["Export…", onExport],
    ] as const) {
      const command = menu.getByRole("button", { name });
      expect(command).toBeEnabled();
      fireEvent.click(command);
      expect(callback).toHaveBeenCalledOnce();
      openFile();
    }
    expect(menu.getByText(DEFAULT_KEYBINDINGS.saveDocument)).toBeVisible();
    expect(menu.getByText(DEFAULT_KEYBINDINGS.closeTab)).toBeVisible();
    fireEvent.click(menu.getByRole("button", { name: "Close tab" }));
    expect(onCloseDocument).toHaveBeenCalledTimes(1);
    openFile();
    fireEvent.click(menu.getByRole("button", { name: "Reopen closed tab" }));
    expect(onReopenDocument).toHaveBeenCalledTimes(1);
    openFile();
    fireEvent.click(menu.getByRole("button", { name: "Reopen Cube project" }));
    expect(onOpenRecentProject).toHaveBeenCalledWith("project-a", "Cube project");

    for (const [label, command] of [
      ["Find", "find"],
      ["Replace", "replace"],
      ["Go to line", "go-to-line"],
      ["Toggle comment", "toggle-comment"],
      ["Format document", "format-document"],
      ["Format selection", "format-selection"],
      ["Undo", "undo"],
      ["Redo", "redo"],
    ] as const) {
      fireEvent.click(menu.getByRole("button", { name: "Edit" }));
      fireEvent.click(menu.getByRole("button", { name: label }));
      expect(onEditorCommand).toHaveBeenLastCalledWith(command);
    }

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

  it("disables save commands only with a truthful unavailability reason", () => {
    const view = render(
      <WebMenuBar
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        renderDisabled={false}
        saveDocumentDisabled
        saveAllDocumentsDisabled
        saveDocumentUnavailableReason="No durable destination"
        saveAllDocumentsUnavailableReason="Additional scratch tabs are not durable"
        onLayoutAction={vi.fn()}
        onRenderFull={vi.fn()}
        onRenderPreview={vi.fn()}
      />,
    );
    fireEvent.click(within(view.container).getByRole("button", { name: "File" }));

    expect(within(view.container).getByRole("button", { name: "Save" })).toHaveAttribute(
      "title",
      "No durable destination",
    );
    expect(within(view.container).getByRole("button", { name: "Save all" })).toHaveAttribute(
      "title",
      "Additional scratch tabs are not durable",
    );
  });

  it("shows active editor bindings and supports arrow-key command traversal", async () => {
    const onEditorCommand = vi.fn();
    const view = render(
      <WebMenuBar
        keybindings={{ ...DEFAULT_KEYBINDINGS, find: "Alt+F", replace: "Alt+H" }}
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        renderDisabled={false}
        onEditorCommand={onEditorCommand}
        onLayoutAction={vi.fn()}
        onRenderFull={vi.fn()}
        onRenderPreview={vi.fn()}
      />,
    );
    const menu = within(view.container);
    const edit = menu.getByRole("button", { name: "Edit" });

    fireEvent.keyDown(edit, { key: "ArrowDown" });

    const find = menu.getByRole("button", { name: "Find" });
    const replace = menu.getByRole("button", { name: "Replace" });
    await waitFor(() => expect(find).toHaveFocus());
    expect(within(find).getByText("Alt+F")).toBeVisible();
    fireEvent.keyDown(find, { key: "ArrowDown" });
    await waitFor(() => expect(replace).toHaveFocus());
    fireEvent.click(replace);
    expect(onEditorCommand).toHaveBeenCalledWith("replace");
  });

  it("routes narrow menu commands to visible overlays, sheets, and primary views", () => {
    const onLayoutAction = vi.fn();
    const view = render(
      <WebMenuBar
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={true}
        renderDisabled={true}
        onLayoutAction={onLayoutAction}
        onRenderFull={vi.fn()}
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
        onRenderFull={vi.fn()}
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

  it("dismisses an open menu when focus moves on or the pointer leaves the menu bar", async () => {
    const view = render(
      <WebMenuBar
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        renderDisabled={false}
        onLayoutAction={vi.fn()}
        onRenderFull={vi.fn()}
        onRenderPreview={vi.fn()}
      />,
    );
    const menu = within(view.container);
    const fileTrigger = menu.getByRole("button", { name: "File" });
    const viewTrigger = menu.getByRole("button", { name: "View" });

    fireEvent.click(fileTrigger);
    expect(view.container.querySelectorAll('[data-menu-open="true"]')).toHaveLength(1);
    viewTrigger.focus();
    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-menu-open="true"]')).toHaveLength(0);
    });

    fireEvent.click(fileTrigger);
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-menu-open="true"]')).toHaveLength(0);
    });
  });
});
