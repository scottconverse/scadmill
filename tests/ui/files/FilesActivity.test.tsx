// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectPortabilityController } from "../../../src/application/files/project-portability";
import { createProjectSnapshot } from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { FilesActivity } from "../../../src/ui/files/FilesActivity";

it("mounts project opening, full export, and web portability product surfaces", () => {
  const engine: EngineService = {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
  const runtime = createWorkbenchRuntime(engine, {
    artifactDestination: {
      available: true,
      kind: "browser-downloads",
      save: vi.fn(),
    },
    initialProject: createProjectSnapshot("project-a", new Map([["main.scad", "cube(10);"]])),
  });
  const portability: ProjectPortabilityController = {
    artifactSavingAvailable: true,
    projectImportAvailable: true,
    copyShareLink: vi.fn(),
    exportProjectZip: vi.fn(),
    importProjectZip: vi.fn(),
    openStartupShare: vi.fn(),
  };
  const storage = {
    snapshot: vi.fn(),
    write: vi.fn(),
    move: vi.fn(),
    trash: vi.fn(),
    reveal: vi.fn(),
  };

  const view = render(
    <FilesActivity
      engine={engine}
      portability={portability}
      runtime={runtime}
      storage={storage}
    />,
  );

  expect(view.getByRole("button", { name: "Open project" })).toBeVisible();
  expect(view.getByRole("button", { name: "Export…" })).toBeVisible();
  expect(view.getByRole("button", { name: "Copy share link" })).toBeVisible();
  expect(portability.openStartupShare).not.toHaveBeenCalled();
});

it("describes missing-engine export as unavailable without implying an in-panel setup action", () => {
  const runtime = createWorkbenchRuntime({
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  });

  const view = render(<FilesActivity runtime={runtime} />);

  expect(view.getByText(
    "Model export requires the pinned OpenSCAD engine and is unavailable in this session.",
  )).toBeVisible();
});
