// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { activeDocument } from "../../../src/application/documents/document-workspace";
import { useProjectNavigation } from "../../../src/ui/editor/use-project-navigation";
import { useReadonlyStore } from "../../../src/ui/use-readonly-store";

const engine: EngineService = {
  render: () => { throw new Error("not used"); },
  export: () => { throw new Error("not used"); },
  version: async () => null,
  cancel: () => undefined,
};

function Harness({ runtime, position }: {
  readonly runtime: ReturnType<typeof createWorkbenchRuntime>;
  readonly position: number;
}) {
  const project = useReadonlyStore(runtime.project, (state) => state);
  const workspace = useReadonlyStore(runtime.documents, (state) => state);
  const document = activeDocument(workspace);
  const navigation = useProjectNavigation({
    runtime,
    project,
    workspace,
    activePath: document.path,
    activeSource: document.source,
  });
  return (
    <>
      <button onClick={() => navigation.goToDefinition(position)} type="button">Go</button>
      <output>{navigation.navigation ? JSON.stringify(navigation.navigation) : "none"}</output>
    </>
  );
}

describe("project navigation coordinator", () => {
  it("opens and activates the cross-file F12 target before issuing an exact editor selection", async () => {
    const source = "use <b.scad>\nbracket();";
    const runtime = createWorkbenchRuntime(engine, {
      initialScratchPath: "main.scad",
      initialScratchSource: source,
      initialProject: createProjectSnapshot("project-a", new Map([
        ["main.scad", source],
        ["b.scad", "module bracket(width = 4) { cube(width); }"],
      ])),
      makeId: () => "definition-document",
    });
    const view = render(<Harness runtime={runtime} position={source.indexOf("bracket") + 2} />);

    fireEvent.click(view.getByRole("button", { name: "Go" }));

    await waitFor(() => expect(activeDocument(runtime.documents.getState()).path).toBe("b.scad"));
    await waitFor(() => expect(JSON.parse(view.getByRole("status").textContent ?? "null"))
      .toMatchObject({ line: 1, column: 8, length: 7 }));
  });
});
