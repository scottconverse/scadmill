// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { messages } from "../../../src/messages/en";
import { ProjectPanel } from "../../../src/ui/files/ProjectPanel";

function engine(): EngineService {
  return {
    render: vi.fn(),
    export: vi.fn(),
    version: vi.fn(),
    cancel: vi.fn(),
  };
}

function setup() {
  const files = new Map<string, ProjectFileContent>([
    ["main.scad", "include <parts/wheel.scad>\ncube(10);"],
    ["parts/wheel.scad", "module wheel() { cylinder(4); }"],
    ["assets/logo.png", new Uint8Array([0x89, 0x50, 0, 255])],
  ]);
  const revealed: string[] = [];
  const storage: ProjectStorage = {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    write: async (_projectId, path, content) => { files.set(path, content); },
    move: async (_projectId, from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error("missing");
      files.delete(from);
      files.set(to, content);
    },
    trash: async (_projectId, path) => { files.delete(path); },
    reveal: async (_projectId, path) => { revealed.push(path); },
  };
  const runtime = createWorkbenchRuntime(engine(), {
    initialProject: createProjectSnapshot("project-a", files),
    projectStorage: storage,
    makeId: () => "project-panel-command",
  });
  return { files, revealed, runtime, storage };
}

describe("ProjectPanel", () => {
  it("explains the platform-specific project locator instead of exposing an internal id", () => {
    const { runtime, storage } = setup();
    const view = render(<ProjectPanel runtime={runtime} storage={storage} canReveal />);

    const folder = view.getByLabelText(messages.projectFolderPath);
    expect(folder).toHaveAccessibleDescription(
      messages.projectFolderPathHelp,
    );
    expect(folder.closest("label")).toHaveClass("project-locator");
    expect(view.getByText(messages.projectFolderPathHelp)).toHaveClass("project-locator-help");

    view.rerender(<ProjectPanel runtime={runtime} storage={storage} />);
    const browser = view.getByLabelText(messages.browserProjectName);
    expect(browser).toHaveAccessibleDescription(
      messages.browserProjectNameHelp,
    );
    expect(browser.closest("label")).toHaveClass("project-locator");
  });

  it("expands nested folders, opens text, and shows a binary placeholder", async () => {
    const { runtime } = setup();
    const view = render(<ProjectPanel runtime={runtime} canReveal />);
    const panel = within(view.container);

    fireEvent.click(panel.getByRole("button", { name: messages.expandProjectFolder("parts") }));
    fireEvent.click(panel.getByRole("button", { name: "wheel.scad" }));
    await waitFor(() => expect(runtime.documents.getState().documents).toContainEqual(
      expect.objectContaining({ path: "parts/wheel.scad" }),
    ));

    fireEvent.click(panel.getByRole("button", { name: messages.expandProjectFolder("assets") }));
    fireEvent.click(panel.getByRole("button", { name: "logo.png" }));
    expect(await panel.findByText(messages.binaryFilePlaceholder("assets/logo.png"))).toBeVisible();
  });

  it("creates, renames, moves, reveals, and trashes project files", async () => {
    const { files, revealed, runtime } = setup();
    const view = render(<ProjectPanel runtime={runtime} canReveal />);
    const panel = within(view.container);

    fireEvent.click(panel.getByRole("button", { name: messages.newProjectFile }));
    fireEvent.change(panel.getByRole("textbox", { name: messages.newProjectFilePath }), {
      target: { value: "draft.scad" },
    });
    fireEvent.click(panel.getByRole("button", { name: messages.createProjectFile }));
    await waitFor(() => expect(files.get("draft.scad")).toBe(""));

    fireEvent.click(panel.getByRole("button", { name: messages.renameProjectFile("draft.scad") }));
    fireEvent.change(panel.getByRole("textbox", { name: messages.renameProjectFile("draft.scad") }), {
      target: { value: "renamed.scad" },
    });
    fireEvent.submit(panel.getByRole("textbox", {
      name: messages.renameProjectFile("draft.scad"),
    }).closest("form") as HTMLFormElement);
    await waitFor(() => expect(files.has("renamed.scad")).toBe(true));

    const renamed = await panel.findByRole("button", { name: "renamed.scad" });
    const partsToggle = panel.getByRole("button", { name: messages.expandProjectFolder("parts") });
    fireEvent.dragStart(renamed.closest('[role="treeitem"]') as HTMLElement);
    fireEvent.drop(partsToggle.closest('[role="treeitem"]') as HTMLElement);
    await waitFor(() => expect(files.has("parts/renamed.scad")).toBe(true));
    fireEvent.click(panel.getByRole("button", { name: messages.expandProjectFolder("parts") }));

    fireEvent.click(panel.getByRole("button", {
      name: messages.revealProjectFile("parts/renamed.scad"),
    }));
    await waitFor(() => expect(revealed).toEqual(["parts/renamed.scad"]));

    await runtime.dispatch({
      kind: "close-document",
      origin: "user",
      documentId: "project-panel-command",
    });
    fireEvent.click(panel.getByRole("button", {
      name: messages.deleteProjectFile("parts/renamed.scad"),
    }));
    await waitFor(() => expect(files.has("parts/renamed.scad")).toBe(false));
  });

  it("moves a file without requiring drag and drop", async () => {
    const { files, runtime } = setup();
    const view = render(<ProjectPanel runtime={runtime} />);
    const panel = within(view.container);

    const moveButton = panel.getByRole("button", { name: messages.moveProjectFile("main.scad") });
    expect(moveButton).toHaveTextContent("⇢");
    fireEvent.click(moveButton);
    fireEvent.change(panel.getByRole("textbox", {
      name: messages.moveProjectFileDestination("main.scad"),
    }), { target: { value: "parts/main.scad" } });
    fireEvent.click(panel.getByRole("button", { name: messages.confirmMoveProjectFile("main.scad") }));

    await waitFor(() => expect(files.has("parts/main.scad")).toBe(true));
    expect(files.has("main.scad")).toBe(false);
  });
});
