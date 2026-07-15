// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { BUILT_IN_SAMPLES } from "../../../src/application/welcome/built-in-samples";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { WelcomeLauncher } from "../../../src/ui/welcome/WelcomeLauncher";

const engine: EngineService = {
  render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
};

describe("WelcomeLauncher", () => {
  it("opens an Appendix F sample in the primary scratch slot and exposes recent work", async () => {
    const runtime = createWorkbenchRuntime(engine, {
      initialScratchSource: "",
      makeId: () => "history-entry",
      recentProjectsPersistence: {
        load: () => [{
          projectId: "project-a",
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
});
