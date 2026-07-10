import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_LAYOUT,
  parseWorkspaceLayout,
  reduceWorkspaceLayout,
  serializeWorkspaceLayout,
  type WorkspaceLayoutAction,
  type WorkspaceLayoutState,
} from "../../../src/application/layout/workspace-layout";

function apply(
  state: WorkspaceLayoutState,
  ...actions: readonly WorkspaceLayoutAction[]
): WorkspaceLayoutState {
  return actions.reduce(reduceWorkspaceLayout, state);
}

describe("workspace layout state", () => {
  it("defines the exact fresh-profile desktop layout", () => {
    expect(DEFAULT_WORKSPACE_LAYOUT).toEqual({
      activeRail: "files",
      dockOpen: true,
      editorOpen: true,
      viewerOpen: true,
      parameterOpen: true,
      consoleOpen: true,
      dockWidth: 260,
      viewerWidth: 480,
      parameterHeight: 220,
      consoleHeight: 180,
      maximized: null,
      narrowView: "code",
      narrowDockOpen: false,
      narrowSheet: null,
    });
    expect(Object.isFrozen(DEFAULT_WORKSPACE_LAYOUT)).toBe(true);
  });

  it("selects one activity destination and collapses an already-active rail", () => {
    const collapsed = reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
      kind: "activate-rail",
      panel: "files",
      narrow: false,
    });
    const switched = reduceWorkspaceLayout(collapsed, {
      kind: "activate-rail",
      panel: "search",
      narrow: false,
    });
    const narrowOpened = reduceWorkspaceLayout(switched, {
      kind: "activate-rail",
      panel: "search",
      narrow: true,
    });
    const narrowCollapsed = reduceWorkspaceLayout(narrowOpened, {
      kind: "activate-rail",
      panel: "search",
      narrow: true,
    });

    expect(collapsed).toMatchObject({ activeRail: "files", dockOpen: false });
    expect(switched).toMatchObject({ activeRail: "search", dockOpen: true });
    expect(narrowOpened).toMatchObject({
      activeRail: "search",
      dockOpen: true,
      narrowDockOpen: true,
    });
    expect(narrowCollapsed.narrowDockOpen).toBe(false);
  });

  it("clamps every persisted splitter dimension to a usable range", () => {
    const state = apply(
      DEFAULT_WORKSPACE_LAYOUT,
      { kind: "resize-panel", panel: "dock", size: 40 },
      { kind: "resize-panel", panel: "viewer", size: 9_999 },
      { kind: "resize-panel", panel: "parameter", size: 10 },
      { kind: "resize-panel", panel: "console", size: 500 },
    );

    expect(state).toMatchObject({
      dockWidth: 180,
      viewerWidth: 720,
      parameterHeight: 120,
      consoleHeight: 400,
    });
  });

  it("toggles panels, maximize state, narrow surfaces, and restores defaults", () => {
    const changed = apply(
      DEFAULT_WORKSPACE_LAYOUT,
      { kind: "toggle-panel", panel: "editor" },
      { kind: "toggle-panel", panel: "parameter" },
      { kind: "toggle-maximize", region: "viewer" },
      { kind: "set-narrow-view", view: "model" },
      { kind: "set-narrow-sheet", sheet: "parameter" },
    );

    expect(changed).toMatchObject({
      editorOpen: false,
      parameterOpen: false,
      maximized: "viewer",
      narrowView: "model",
      narrowSheet: "parameter",
    });
    expect(
      reduceWorkspaceLayout(changed, { kind: "toggle-maximize", region: "viewer" })
        .maximized,
    ).toBeNull();
    expect(reduceWorkspaceLayout(changed, { kind: "reset-layout" })).toEqual(
      DEFAULT_WORKSPACE_LAYOUT,
    );
  });

  it("switches to the model before opening the narrow parameter sheet", () => {
    const opened = reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
      kind: "set-narrow-sheet",
      sheet: "parameter",
    });

    expect(opened).toMatchObject({ narrowView: "model", narrowSheet: "parameter" });
    expect(
      reduceWorkspaceLayout(opened, { kind: "set-narrow-view", view: "code" }),
    ).toMatchObject({ narrowView: "code", narrowSheet: null });
  });

  it("auto-opens once per failed render job without changing state on success", () => {
    const collapsed = reduceWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT, {
      kind: "toggle-panel",
      panel: "console",
    });
    const firstFailure = reduceWorkspaceLayout(collapsed, {
      kind: "render-failed",
      jobId: "render-1",
    });
    const dismissedNarrow = reduceWorkspaceLayout(firstFailure, {
      kind: "set-narrow-sheet",
      sheet: null,
    });
    const userCollapsed = reduceWorkspaceLayout(firstFailure, {
      kind: "toggle-panel",
      panel: "console",
    });
    const duplicateFailure = reduceWorkspaceLayout(userCollapsed, {
      kind: "render-failed",
      jobId: "render-1",
    });
    const success = reduceWorkspaceLayout(duplicateFailure, {
      kind: "render-succeeded",
      jobId: "render-2",
    });
    const laterFailure = reduceWorkspaceLayout(success, {
      kind: "render-failed",
      jobId: "render-3",
    });

    expect(firstFailure).toMatchObject({
      consoleOpen: true,
      narrowSheet: "console",
      maximized: null,
      consoleAutoOpenedForJobId: "render-1",
    });
    expect(dismissedNarrow).toMatchObject({ consoleOpen: true, narrowSheet: null });
    expect(duplicateFailure).toBe(userCollapsed);
    expect(success).toBe(duplicateFailure);
    expect(laterFailure).toMatchObject({
      consoleOpen: true,
      narrowSheet: "console",
      consoleAutoOpenedForJobId: "render-3",
    });

    const maximizedFailure = reduceWorkspaceLayout(
      reduceWorkspaceLayout(collapsed, { kind: "toggle-maximize", region: "editor" }),
      { kind: "render-failed", jobId: "render-maximized" },
    );
    expect(maximizedFailure).toMatchObject({
      maximized: null,
      consoleOpen: true,
      narrowSheet: "console",
    });
  });

  it("keeps transient narrow sheets independent from durable wide collapsed state", () => {
    const collapsed = apply(
      DEFAULT_WORKSPACE_LAYOUT,
      { kind: "toggle-panel", panel: "parameter" },
      { kind: "toggle-panel", panel: "console" },
    );
    const consoleSheet = reduceWorkspaceLayout(collapsed, {
      kind: "set-narrow-sheet",
      sheet: "console",
    });
    const parameterSheet = reduceWorkspaceLayout(consoleSheet, {
      kind: "set-narrow-sheet",
      sheet: "parameter",
    });
    const dismissed = reduceWorkspaceLayout(parameterSheet, {
      kind: "set-narrow-sheet",
      sheet: null,
    });

    expect(consoleSheet).toMatchObject({ consoleOpen: false, parameterOpen: false });
    expect(parameterSheet).toMatchObject({ consoleOpen: false, parameterOpen: false });
    expect(dismissed).toMatchObject({
      consoleOpen: false,
      parameterOpen: false,
      narrowSheet: null,
    });
  });

  it("round-trips only durable layout data and rejects malformed persistence", () => {
    const changed = apply(
      DEFAULT_WORKSPACE_LAYOUT,
      { kind: "resize-panel", panel: "dock", size: 340 },
      { kind: "toggle-panel", panel: "console" },
      { kind: "activate-rail", panel: "libraries", narrow: false },
      { kind: "render-failed", jobId: "ephemeral-job" },
      { kind: "set-narrow-sheet", sheet: "console" },
    );

    const restored = parseWorkspaceLayout(serializeWorkspaceLayout(changed));

    expect(restored).toMatchObject({
      activeRail: "libraries",
      dockWidth: 340,
      consoleOpen: true,
      maximized: null,
      narrowDockOpen: false,
      narrowSheet: null,
    });
    expect(restored.consoleAutoOpenedForJobId).toBeUndefined();
    expect(parseWorkspaceLayout("{ not json")).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    expect(parseWorkspaceLayout('{"version":1,"dockWidth":"wide"}')).toEqual(
      DEFAULT_WORKSPACE_LAYOUT,
    );
    expect(
      parseWorkspaceLayout(
        JSON.stringify({ ...JSON.parse(serializeWorkspaceLayout(changed)), unexpected: true }),
      ),
    ).toEqual(DEFAULT_WORKSPACE_LAYOUT);
    expect(parseWorkspaceLayout(null)).toEqual(DEFAULT_WORKSPACE_LAYOUT);
  });
});
