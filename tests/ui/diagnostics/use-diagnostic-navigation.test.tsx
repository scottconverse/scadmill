// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Diagnostic, EngineService } from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { useDiagnosticNavigation } from "../../../src/ui/diagnostics/use-diagnostic-navigation";

function Harness({ diagnostic, runtime }: {
  readonly diagnostic: Diagnostic;
  readonly runtime: ReturnType<typeof createWorkbenchRuntime>;
}) {
  const navigation = useDiagnosticNavigation({
    diagnostics: [diagnostic],
    entryFile: "main.scad",
    runtime,
    workspace: runtime.documents.getState(),
  });
  return (
    <button
      disabled={!navigation.canNavigate(diagnostic)}
      onClick={() => navigation.navigate(diagnostic)}
      type="button"
    >
      Navigate
    </button>
  );
}

describe("diagnostic navigation", () => {
  it("opens an unloaded text file from the project snapshot before navigation", async () => {
    const engine: EngineService = {
      render: () => { throw new Error("not used"); },
      export: () => { throw new Error("not used"); },
      version: async () => null,
      cancel: () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine, {
      initialProject: createProjectSnapshot("project-a", new Map([
        ["main.scad", "include <parts/wheel.scad>\ncube(10);"],
        ["parts/wheel.scad", "radius = 4;\ncylinder(r = radius, h = 2);"],
      ])),
      makeId: () => "unloaded-diagnostic-document",
    });
    const diagnostic: Diagnostic = {
      severity: "error",
      message: "Parser error in unloaded include",
      file: "parts/wheel.scad",
      line: 2,
    };
    const view = render(<Harness diagnostic={diagnostic} runtime={runtime} />);

    const button = view.getByRole("button", { name: "Navigate" });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(runtime.documents.getState().documents).toContainEqual(
      expect.objectContaining({
        path: "parts/wheel.scad",
        source: "radius = 4;\ncylinder(r = radius, h = 2);",
      }),
    ));
  });
});
