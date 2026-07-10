// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKSPACE_LAYOUT,
  reduceWorkspaceLayout,
} from "../../../src/application/layout/workspace-layout";
import { WorkspaceFrame } from "../../../src/ui/layout/WorkspaceFrame";

const editor = <section aria-label="OpenSCAD code editor">Editor fixture</section>;
const viewer = <section aria-label="Model viewer">Viewer fixture</section>;
const ORIGINAL_VIEWPORT_WIDTH = window.innerWidth;

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
});

afterAll(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: ORIGINAL_VIEWPORT_WIDTH,
  });
});

describe("WorkspaceFrame", () => {
  it("renders the exact wide layout landmarks and four splitters", () => {
    const view = render(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );
    const frame = within(view.container);

    expect(frame.getByRole("navigation", { name: "Activity rail" })).toBeVisible();
    expect(frame.getAllByRole("button", { name: /^(Files|Search|History|AI|Libraries)$/u })).toHaveLength(5);
    expect(frame.getByRole("region", { name: "Files panel" })).toBeVisible();
    expect(frame.getByRole("region", { name: "OpenSCAD code editor" })).toBeVisible();
    expect(frame.getByRole("region", { name: "Model viewer" })).toBeVisible();
    expect(frame.getByRole("region", { name: "Parameters" })).toBeVisible();
    expect(frame.getByRole("region", { name: "Console" })).toBeVisible();
    expect(frame.getAllByRole("separator")).toHaveLength(4);
  });

  it("renders activity badges and mouse-accessible parameter and console toggles", () => {
    const onLayoutAction = vi.fn();
    const view = render(
      <WorkspaceFrame
        activityBadges={{ ai: true }}
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={true}
        editor={editor}
        viewer={viewer}
        onLayoutAction={onLayoutAction}
      />,
    );
    const rail = within(
      within(view.container).getByRole("navigation", { name: "Activity rail" }),
    );

    expect(
      rail.getByRole("button", { name: "AI, activity pending" }).querySelector(".activity-badge"),
    ).not.toBeNull();
    fireEvent.click(rail.getByRole("button", { name: "Toggle parameter panel" }));
    fireEvent.click(rail.getByRole("button", { name: "Toggle console" }));

    expect(onLayoutAction.mock.calls).toEqual([
      [{ kind: "set-narrow-sheet", sheet: "parameter" }],
      [{ kind: "set-narrow-sheet", sheet: "console" }],
    ]);
  });

  it("dispatches rail, collapse, reset, and resize gestures as layout actions", () => {
    const onLayoutAction = vi.fn();
    const view = render(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={onLayoutAction}
      />,
    );
    const frame = within(view.container);

    fireEvent.click(frame.getByRole("button", { name: "Search" }));
    fireEvent.click(frame.getByRole("button", { name: "Collapse parameters" }));
    fireEvent.click(frame.getByRole("button", { name: "Collapse console" }));
    fireEvent.click(frame.getByRole("button", { name: "Reset layout" }));
    fireEvent.keyDown(frame.getByRole("separator", { name: "Resize files panel" }), {
      key: "ArrowRight",
    });

    expect(onLayoutAction.mock.calls).toEqual([
      [{ kind: "activate-rail", panel: "search", narrow: false }],
      [{ kind: "toggle-panel", panel: "parameter" }],
      [{ kind: "toggle-panel", panel: "console" }],
      [{ kind: "reset-layout" }],
      [{ kind: "resize-panel", panel: "dock", size: 268 }],
    ]);
  });

  it("previews a drag in the grid without dispatching until release", () => {
    const onLayoutAction = vi.fn();
    const view = render(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={onLayoutAction}
      />,
    );
    const frame = within(view.container);
    const splitter = frame.getByRole("separator", { name: "Resize files panel" });
    const primary = view.container.querySelector(".workspace-primary");

    fireEvent.pointerDown(splitter, { pointerId: 11, clientX: 260 });
    fireEvent.pointerMove(splitter, { pointerId: 11, clientX: 300 });

    expect((primary as HTMLElement).style.gridTemplateColumns).toContain("300px");
    expect(onLayoutAction).not.toHaveBeenCalled();

    fireEvent.pointerUp(splitter, { pointerId: 11, clientX: 300 });
    expect(onLayoutAction).toHaveBeenCalledTimes(1);
    expect(onLayoutAction).toHaveBeenCalledWith({
      kind: "resize-panel",
      panel: "dock",
      size: 300,
    });
  });

  it("discards an unfinished local preview when its panel closes", async () => {
    const view = render(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );
    const splitter = within(view.container).getByRole("separator", {
      name: "Resize files panel",
    });
    const primary = view.container.querySelector(".workspace-primary") as HTMLElement;

    fireEvent.pointerDown(splitter, { pointerId: 12, clientX: 260 });
    fireEvent.pointerMove(splitter, { pointerId: 12, clientX: 300 });
    expect(primary.style.gridTemplateColumns).toContain("300px");

    const closed = reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
      kind: "toggle-panel",
      panel: "dock",
    });
    view.rerender(
      <WorkspaceFrame
        layout={closed}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );
    view.rerender(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );

    await waitFor(() => expect(primary.style.gridTemplateColumns).toContain("260px"));
  });

  it("discards a viewer resize preview when the editor collapses", async () => {
    const view = render(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );
    const splitter = within(view.container).getByRole("separator", {
      name: "Resize viewer column",
    });
    const primary = view.container.querySelector(".workspace-primary") as HTMLElement;

    fireEvent.pointerDown(splitter, { pointerId: 13, clientX: 700 });
    fireEvent.pointerMove(splitter, { pointerId: 13, clientX: 660 });
    expect(primary.style.gridTemplateColumns).toContain("520px");

    const editorClosed = reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
      kind: "toggle-panel",
      panel: "editor",
    });
    view.rerender(
      <WorkspaceFrame
        layout={editorClosed}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );
    view.rerender(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );

    await waitFor(() => expect(primary.style.gridTemplateColumns).toContain("480px"));
  });

  it("keeps both primary surfaces mounted while the narrow switcher chooses one", () => {
    const onLayoutAction = vi.fn();
    const view = render(
      <WorkspaceFrame
        layout={DEFAULT_WORKSPACE_LAYOUT}
        narrow={true}
        editor={editor}
        viewer={viewer}
        onLayoutAction={onLayoutAction}
      />,
    );
    const frame = within(view.container);
    const editorRegion = frame.getByRole("region", { name: "OpenSCAD code editor", hidden: true });
    const viewerRegion = frame.getByRole("region", { name: "Model viewer", hidden: true });

    expect(frame.getByRole("group", { name: "Workspace view" })).toBeVisible();
    expect(editorRegion.closest(".workspace-editor")).not.toHaveAttribute("hidden");
    expect(viewerRegion.closest(".workspace-viewer")).toHaveAttribute("hidden");

    fireEvent.click(frame.getByRole("button", { name: "Model" }));
    expect(onLayoutAction).toHaveBeenLastCalledWith({ kind: "set-narrow-view", view: "model" });

    view.rerender(
      <WorkspaceFrame
        layout={reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
          kind: "set-narrow-view",
          view: "model",
        })}
        narrow={true}
        editor={editor}
        viewer={viewer}
        onLayoutAction={onLayoutAction}
      />,
    );

    expect(editorRegion.closest(".workspace-editor")).toHaveAttribute("hidden");
    expect(viewerRegion.closest(".workspace-viewer")).not.toHaveAttribute("hidden");
    fireEvent.click(frame.getByRole("button", { name: "Files" }));
    expect(onLayoutAction).toHaveBeenLastCalledWith({
      kind: "activate-rail",
      panel: "files",
      narrow: true,
    });
  });

  it("hides every competing surface when a primary region is maximized", () => {
    const maximized = reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
      kind: "toggle-maximize",
      region: "editor",
    });
    const view = render(
      <WorkspaceFrame
        layout={maximized}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );

    expect(view.container.querySelector(".workspace-editor")).not.toHaveAttribute("hidden");
    expect(view.container.querySelector(".workspace-dock")).toHaveAttribute("hidden");
    expect(view.container.querySelector(".workspace-viewer-column")).toHaveAttribute("hidden");
    expect(view.container.querySelector(".workspace-console")).toHaveAttribute("hidden");
    expect(within(view.container).getByRole("button", { name: "Files" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      within(view.container).getByRole("button", { name: "Toggle console" }),
    ).toHaveAttribute("aria-pressed", "false");

    view.rerender(
      <WorkspaceFrame
        layout={reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
          kind: "toggle-maximize",
          region: "viewer",
        })}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );

    expect(view.container.querySelector(".workspace-viewer-column")).not.toHaveAttribute("hidden");
    expect(view.container.querySelector(".workspace-editor")).toHaveAttribute("hidden");
    expect(view.container.querySelector(".workspace-parameter-panel")).toHaveAttribute("hidden");
    expect(view.container.querySelector(".workspace-console")).toHaveAttribute("hidden");
    expect(
      within(view.container).getByRole("button", { name: "Toggle parameter panel" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("constrains persisted side widths to leave a usable editor track", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
    const view = render(
      <WorkspaceFrame
        layout={{ ...DEFAULT_WORKSPACE_LAYOUT, dockWidth: 480, viewerWidth: 720 }}
        narrow={false}
        editor={editor}
        viewer={viewer}
        onLayoutAction={vi.fn()}
      />,
    );

    expect(
      (view.container.querySelector(".workspace-primary") as HTMLElement).style.gridTemplateColumns,
    ).toContain("min(336px, 28vw)");
    expect(
      (view.container.querySelector(".workspace-primary") as HTMLElement).style.gridTemplateColumns,
    ).toContain("min(528px, 44vw)");
  });
});
