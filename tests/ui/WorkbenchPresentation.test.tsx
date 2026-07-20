// @vitest-environment happy-dom
import { act, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess3D } from "../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { Workbench } from "../../src/ui/Workbench";

const viewerHarness = vi.hoisted(() => ({ reportReady: undefined as (() => void) | undefined }));

vi.mock("../../src/ui/viewer/ViewerPaneConnector", () => ({
  ViewerPaneConnector: (props: {
    readonly onPresentationReady?: (token: string) => void;
    readonly viewer: { readonly presentation?: { readonly renderIdentity: string } };
  }) => {
    viewerHarness.reportReady = () => {
      const token = props.viewer.presentation?.renderIdentity;
      if (token) props.onPresentationReady?.(token);
    };
    return <section aria-label="controlled viewer" />;
  },
}));

function result(): RenderSuccess3D {
  return {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
    stats: { triangles: 0, engineTimeMs: 1 },
    diagnostics: [],
    rawLog: "rendered",
  };
}

describe("Workbench presentation status", () => {
  it("does not publish Rendered between engine completion and the matching viewer callback", async () => {
    const engine: EngineService = {
      render: vi.fn(() => ({
        jobId: "presentation-order",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve(result()),
      })),
      export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "presentation-command", renderCache: null });
    const view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        engine={engine}
        engineLabel="OpenSCAD 2026.06.12"
        onThemePreferenceChange={vi.fn()}
        runtime={runtime}
        themePreference="system"
      />,
    );
    const workbench = within(view.container);

    await act(async () => runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" }));

    expect(await workbench.findByText("Presenting main.scad...")).toBeVisible();
    expect(workbench.queryByText("Rendered main.scad (3d)")).not.toBeInTheDocument();
    await waitFor(() => expect(viewerHarness.reportReady).toBeDefined());
    act(() => viewerHarness.reportReady?.());
    expect(await workbench.findByText("Rendered main.scad (3d)")).toBeVisible();
    runtime.dispose();
  });
});
