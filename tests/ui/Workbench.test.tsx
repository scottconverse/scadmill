// @vitest-environment happy-dom
import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService, RenderSuccess3D } from "../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { Workbench } from "../../src/ui/Workbench";

function oneTriangleStl(): Uint8Array {
  const bytes = new Uint8Array(134);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  const vertices = [[0, 0, 0], [10, 0, 0], [10, 10, 10]];
  vertices.flat().forEach((coordinate, index) => {
    view.setFloat32(96 + index * 4, coordinate, true);
  });
  return bytes;
}

describe("Workbench", () => {
  it("keeps the active theme control in the always-visible status bar", () => {
    const engine: EngineService = {
      render: vi.fn(),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "command-1" });

    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );

    expect(within(view.container).getByRole("combobox", { name: "Theme" }).closest("footer")).toHaveClass(
      "statusbar",
    );
  });

  it("renders preview geometry and its measured engine bounds", async () => {
    const result: RenderSuccess3D = {
      kind: "3d",
      mesh: { format: "stl-binary", bytes: oneTriangleStl() },
      stats: {
        triangles: 12,
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        engineTimeMs: 12,
      },
      diagnostics: [],
      rawLog: "rendered",
    };
    const engine: EngineService = {
      render: vi.fn().mockReturnValue({ jobId: "render-1", done: Promise.resolve(result) }),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine, { makeId: () => "command-1" });
    const view = render(
      <Workbench
        runtime={runtime}
        engineLabel="OpenSCAD 2021.01"
        activeTheme={SHIPPED_THEMES[0]}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );

    const workbench = within(view.container);
    fireEvent.click(workbench.getByRole("button", { name: "Render preview" }));

    expect(await workbench.findByText("10 × 10 × 10 mm")).toBeVisible();
    expect(workbench.getByText("Preview quality")).toBeVisible();
    expect(engine.render).toHaveBeenCalledTimes(1);
  });
});
