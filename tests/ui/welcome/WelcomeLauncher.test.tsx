// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { BUILT_IN_SAMPLES } from "../../../src/application/welcome/built-in-samples";
import { WelcomeLauncher } from "../../../src/ui/welcome/WelcomeLauncher";

const engine: EngineService = {
  render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
};

describe("WelcomeLauncher", () => {
  it("reflects an undo or redo of the startup preference while the dialog is open", () => {
    const runtime = createWorkbenchRuntime(engine);
    const renderLauncher = (showOnLaunch: boolean) => (
      <WelcomeLauncher
        documents={runtime.documents.getState()}
        project={runtime.project.getState()}
        runtime={runtime}
        showOnLaunch={showOnLaunch}
        onNewFile={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecentProject={vi.fn()}
        onShowOnLaunchChange={vi.fn()}
      />
    );
    const view = render(renderLauncher(true));
    expect(view.getByRole("checkbox", { name: "Show welcome screen on startup" })).toBeChecked();

    view.rerender(renderLauncher(false));
    expect(view.getByRole("checkbox", { name: "Show welcome screen on startup" })).not.toBeChecked();
  });

  it("opens an Appendix F sample in the primary scratch slot and exposes recent work", async () => {
    const runtime = createWorkbenchRuntime(engine, {
      initialScratchSource: "",
      makeId: () => "history-entry",
      recentProjectsPersistence: {
        load: () => [{
          projectId: "project-a",
          workspaceIdentity: "project-a",
          displayName: "Gear assembly",
          openedAt: "2026-07-15T00:00:00.000Z",
        }],
        save: vi.fn(),
      },
    });
    const onOpenRecentProject = vi.fn();
    const onShowOnLaunchChange = vi.fn();
    const view = render(
      <WelcomeLauncher
        documents={runtime.documents.getState()}
        project={runtime.project.getState()}
        runtime={runtime}
        showOnLaunch
        onNewFile={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecentProject={onOpenRecentProject}
        onShowOnLaunchChange={onShowOnLaunchChange}
      />,
    );
    const ui = within(view.container);

    expect(ui.getByRole("dialog", { name: "Welcome to ScadMill" })).toBeVisible();
    expect(ui.getAllByRole("button", { name: /Open sample/iu })).toHaveLength(3);
    fireEvent.click(ui.getByRole("button", { name: "Reopen Gear assembly" }));
    expect(onOpenRecentProject).toHaveBeenCalledWith("project-a", "Gear assembly");

    fireEvent.click(ui.getByRole("button", { name: "Welcome" }));
    fireEvent.click(ui.getByRole("checkbox", { name: "Show welcome screen on startup" }));
    expect(onShowOnLaunchChange).toHaveBeenCalledWith(false);
    fireEvent.click(ui.getByRole("button", { name: "Open sample Parametric storage box" }));

    await waitFor(() => expect(runtime.documents.getState().documents[0]).toMatchObject({
      id: "document-main",
      path: "parametric_box.scad",
      source: BUILT_IN_SAMPLES[0].source,
    }));
    expect(runtime.parameters.getState().documents.get("document-main")?.parameters)
      .toHaveLength(9);
    expect(ui.queryByRole("dialog", { name: "Welcome to ScadMill" })).not.toBeInTheDocument();
  });

  it("requires confirmation before replacing non-empty work with a sample", async () => {
    const runtime = createWorkbenchRuntime(engine);
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(99);",
    });
    const view = render(
      <WelcomeLauncher
        documents={runtime.documents.getState()}
        project={runtime.project.getState()}
        runtime={runtime}
        showOnLaunch
        onNewFile={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecentProject={vi.fn()}
        onShowOnLaunchChange={vi.fn()}
      />,
    );
    const ui = within(view.container);

    fireEvent.click(ui.getByRole("button", { name: "Open sample Gear knob" }));
    expect(ui.getByRole("alertdialog", { name: "Replace current work?" })).toBeVisible();
    expect(runtime.documents.getState().documents[0].source).toBe("cube(99);");
    fireEvent.click(ui.getByRole("button", { name: "Replace with Gear knob" }));

    await waitFor(() => expect(runtime.documents.getState().documents[0].source)
      .toBe(BUILT_IN_SAMPLES[1].source));
  });

  it("contains focus in the active dialog and restores the sample trigger after cancellation", async () => {
    const runtime = createWorkbenchRuntime(engine);
    await runtime.dispatch({
      kind: "edit-document",
      origin: "user",
      documentId: "document-main",
      source: "cube(99);",
    });
    const user = userEvent.setup();
    const view = render(
      <WelcomeLauncher
        documents={runtime.documents.getState()}
        project={runtime.project.getState()}
        runtime={runtime}
        showOnLaunch
        onNewFile={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenRecentProject={vi.fn()}
        onShowOnLaunchChange={vi.fn()}
      />,
    );
    const ui = within(view.container);
    const dialog = ui.getByRole("dialog", { name: "Welcome to ScadMill" });
    const close = ui.getByRole("button", { name: "Close welcome" });
    const startup = ui.getByRole("checkbox", { name: "Show welcome screen on startup" });

    expect(dialog).toHaveAccessibleDescription(
      "Start from a blank file, open a project, or explore a built-in OpenSCAD model.",
    );
    expect(ui.getByRole("button", { name: "Open project" })).toBeVisible();
    expect(ui.queryByRole("button", { name: /^Reopen /u })).not.toBeInTheDocument();
    await waitFor(() => expect(ui.getByRole("button", { name: "New file" })).toHaveFocus());
    close.focus();
    await user.tab({ shift: true });
    expect(startup).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.click(ui.getByRole("button", { name: "Open sample Gear knob" }));
    const confirmation = ui.getByRole("alertdialog", { name: "Replace current work?" });
    const keep = ui.getByRole("button", { name: "Keep current work" });
    const replace = ui.getByRole("button", { name: "Replace with Gear knob" });
    expect(confirmation).toHaveAccessibleDescription(
      "Opening Gear knob replaces the current workspace. Unsaved work will be lost.",
    );
    await waitFor(() => expect(keep).toHaveFocus());
    replace.focus();
    await user.tab();
    expect(keep).toHaveFocus();
    await user.tab({ shift: true });
    expect(replace).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(ui.queryByRole("alertdialog", { name: "Replace current work?" }))
      .not.toBeInTheDocument();
    await waitFor(() => expect(
      ui.getByRole("button", { name: "Open sample Gear knob" }),
    ).toHaveFocus());
    expect(dialog).toBeVisible();
  });
});
