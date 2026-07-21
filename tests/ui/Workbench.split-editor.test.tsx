// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService, RenderFailure } from "../../src/application/engine/contracts";
import { createWorkbenchRuntime } from "../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../src/application/theme/shipped-themes";
import { Workbench } from "../../src/ui/Workbench";

const failure: RenderFailure = {
  kind: "failure",
  reason: "engine-error",
  diagnostics: [],
  rawLog: "test",
};

describe("Workbench split editor", () => {
  it("renders the active document from whichever editor group receives focus", async () => {
    const engine: EngineService = {
      render: vi.fn().mockImplementation(() => ({
        jobId: `split-render-${Date.now()}`,
        done: Promise.resolve(failure),
        subscribeOutput: () => () => undefined,
      })),
      export: vi.fn(),
      version: vi.fn(),
      cancel: vi.fn(),
    };
    const runtime = createWorkbenchRuntime(engine);
    await runtime.dispatch({
      kind: "open-document",
      origin: "user",
      document: { id: "wheel", path: "parts/wheel.scad", source: "cylinder(2);" },
    });
    await runtime.dispatch({ kind: "activate-document", origin: "user", documentId: "document-main" });
    const view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        engineLabel="OpenSCAD 2026.06.12"
        onThemePreferenceChange={vi.fn()}
        runtime={runtime}
        themePreference="system"
      />,
    );

    fireEvent.click(view.getByRole("checkbox", { name: "Auto-render" }));
    await waitFor(() => expect(runtime.settings.getState().autoRender).toBe(false));
    fireEvent.click(view.getByRole("button", { name: "Split editor" }));

    const primary = view.getByRole("region", { name: "Primary editor group" });
    const secondary = view.getByRole("region", { name: "Secondary editor group" });
    fireEvent.click(within(primary).getByRole("tab", { name: "wheel.scad" }));
    await waitFor(() => expect(runtime.documents.getState().activeDocumentId).toBe("wheel"));
    fireEvent.click(within(view.container.querySelector(".titlebar") as HTMLElement)
      .getByRole("button", { name: "Render preview" }));
    await waitFor(() => expect(engine.render).toHaveBeenLastCalledWith(expect.objectContaining({
      entryFile: "parts/wheel.scad",
    })));

    fireEvent.click(within(secondary).getByRole("tab", { name: "main.scad" }));
    await waitFor(() => expect(runtime.documents.getState().activeDocumentId).toBe("document-main"));
    fireEvent.click(within(view.container.querySelector(".titlebar") as HTMLElement)
      .getByRole("button", { name: "Render preview" }));
    await waitFor(() => expect(engine.render).toHaveBeenLastCalledWith(expect.objectContaining({
      entryFile: "main.scad",
    })));
  });
});
