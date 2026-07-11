// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createDocumentWorkspace,
  type DocumentWorkspaceState,
  reduceDocumentWorkspace,
} from "../../../src/application/documents/document-workspace";
import { createProjectSessionState } from "../../../src/application/files/project-session";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { useProjectCompletionContext } from "../../../src/ui/editor/use-project-completion-context";

describe("useProjectCompletionContext", () => {
  it("keeps project lookup identity across active edits but revisions dependency edits", () => {
    const project = createProjectSessionState(createProjectSnapshot(
      "project",
      new Map([
        ["main.scad", "include <lib.scad>\npart();"],
        ["lib.scad", "module part() {}"],
      ]),
    ), "project");
    const initial = createDocumentWorkspace([
      { id: "main", path: "main.scad", source: "include <lib.scad>\npart();" },
      { id: "lib", path: "lib.scad", source: "module part() {}" },
    ]);
    const view = renderHook(
      ({ workspace }: { workspace: DocumentWorkspaceState }) =>
        useProjectCompletionContext(project, workspace),
      { initialProps: { workspace: initial } },
    );
    const first = view.result.current;

    const activeEdit = reduceDocumentWorkspace(initial, {
      kind: "edit",
      documentId: "main",
      source: "include <lib.scad>\npart(2);",
    });
    view.rerender({ workspace: activeEdit });

    expect(view.result.current).toBe(first);
    expect(view.result.current?.sources.get("main.scad")).toBe("include <lib.scad>\npart(2);");

    const dependencyEdit = reduceDocumentWorkspace(activeEdit, {
      kind: "edit",
      documentId: "lib",
      source: "module part(size = 2) {}",
    });
    view.rerender({ workspace: dependencyEdit });

    expect(view.result.current).not.toBe(first);
    expect(view.result.current?.sources.get("lib.scad")).toBe("module part(size = 2) {}");
  });
});
