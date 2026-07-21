// @vitest-environment happy-dom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService, Quality, RenderSuccess3D } from "../../src/application/engine/contracts";
import type { SlicerHandoffPort } from "../../src/application/manufacturing/slicer-handoff";
import { createWorkbenchRuntime } from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { messages } from "../../src/messages/en";
import { Workbench } from "../../src/ui/Workbench";

vi.mock("../../src/ui/viewer/ViewerPaneConnector", () => ({
  ViewerPaneConnector: () => <section aria-label="controlled viewer" />,
}));

function result(): RenderSuccess3D {
  return {
    kind: "3d",
    mesh: { format: "stl-binary", bytes: new Uint8Array(84) },
    stats: { engineTimeMs: 1 },
    diagnostics: [],
    rawLog: "rendered",
  };
}

describe("Workbench manufacturing integration", () => {
  it("enables printability only for the last full render", async () => {
    let job = 0;
    const qualities: Quality[] = [];
    const engine: EngineService = {
      render: vi.fn((request) => {
        qualities.push(request.quality);
        job += 1;
        return {
          jobId: `manufacturing-${job}`,
          subscribeOutput: () => () => undefined,
          done: Promise.resolve(result()),
        };
      }),
      export: vi.fn(), version: vi.fn(), cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { renderCache: null });
    await runtime.dispatch({ kind: "render-active", origin: "user", quality: "preview" });
    const view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        engineLabel="OpenSCAD test"
        onThemePreferenceChange={vi.fn()}
        runtime={runtime}
        themePreference="system"
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.activityManufacturing }));
    expect(await view.findByText(messages.printabilityNeedsFullRender)).toBeVisible();
    expect(view.getByRole("button", { name: messages.runPrintabilityCheck })).toBeDisabled();

    await act(async () => runtime.dispatch({ kind: "render-active", origin: "user", quality: "full" }));

    await waitFor(() => expect(view.getByRole("button", { name: messages.runPrintabilityCheck })).toBeEnabled());
    expect(qualities).toEqual(["preview", "full"]);
    runtime.dispose();
  });

  it("exports the current project as 3MF before invoking the desktop slicer port", async () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(() => ({
        jobId: "workbench-slicer",
        subscribeOutput: () => () => undefined,
        done: Promise.resolve({ ok: true, bytes: Uint8Array.of(80, 75), diagnostics: [], rawLog: "" }),
      })),
      version: vi.fn(), cancel: vi.fn(),
    };
    const open = vi.fn(async () => ({
      slicerName: "PrusaSlicer",
      temporaryFile: "C:/Temp/main.3mf",
    }));
    const slicerHandoff: SlicerHandoffPort = { open };
    const runtime = createWorkbenchRuntime(engine, { renderCache: null });
    const view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        engine={engine}
        engineLabel="OpenSCAD test"
        onThemePreferenceChange={vi.fn()}
        runtime={runtime}
        slicerHandoff={slicerHandoff}
        themePreference="system"
      />,
    );

    fireEvent.click(view.getByRole("button", { name: messages.activityManufacturing }));
    fireEvent.click(await view.findByRole("button", { name: messages.openInSlicer }));

    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    expect(engine.export).toHaveBeenCalledWith(expect.objectContaining({ format: "3mf" }));
    expect(await view.findByText(messages.slicerOpened("PrusaSlicer"))).toBeVisible();
    runtime.dispose();
  });
});
