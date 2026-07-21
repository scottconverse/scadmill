// @vitest-environment happy-dom

import { strToU8, zipSync } from "fflate";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import { createProjectSessionState } from "../../../src/application/files/project-session";
import { createProjectSnapshot, type ProjectFileContent } from "../../../src/application/files/project-snapshot";
import { LibrariesActivity } from "../../../src/ui/libraries/LibrariesActivity";

function packageArchive(): Uint8Array {
  return zipSync({
    "BOSL2-2.0.747/LICENSE": strToU8("BSD 2-Clause License\nPermission is granted."),
    "BOSL2-2.0.747/std.scad": strToU8("module cuboid(size = 1, anchor = CENTER) { cube(size); }"),
  });
}

function projectFixture() {
  const files = new Map<string, ProjectFileContent>([["main.scad", "include <BOSL2/std.scad>"]]);
  const storage: ProjectStorage = {
    snapshot: async (projectId) => createProjectSnapshot(projectId, files),
    read: async (_projectId, path) => files.get(path),
    write: vi.fn(async (_projectId, path, content) => {
      files.set(path, content);
    }),
    move: vi.fn(),
    trash: vi.fn(async (_projectId, path) => {
      files.delete(path);
    }),
    reveal: vi.fn(),
  };
  return {
    files,
    project: createProjectSessionState(
      createProjectSnapshot("fixture", files),
      "project",
      "Fixture",
    ),
    storage,
  };
}

function libraryCard(name: string): HTMLElement {
  const card = screen.getByRole("heading", { name }).closest("article");
  if (!card) throw new Error(`Library card ${name} is missing.`);
  return card;
}

describe("LibrariesActivity", () => {
  it("shows the downloaded license before confirming a pinned install", async () => {
    const user = userEvent.setup();
    const fixture = projectFixture();
    const onProjectFilesChanged = vi.fn(async () => undefined);
    render(
      <LibrariesActivity
        download={vi.fn(async () => packageArchive())}
        onProjectFilesChanged={onProjectFilesChanged}
        project={fixture.project}
        storage={fixture.storage}
      />,
    );

    const bosl2 = libraryCard("BOSL2");
    expect(within(bosl2).getByText("Pinned v2.0.747")).toBeInTheDocument();
    expect(within(bosl2).getByText("BSD-2-Clause")).toBeInTheDocument();
    const review = within(bosl2).getByRole("button", { name: "Review BOSL2 license" });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);

    expect(await screen.findByText(/Permission is granted/)).toBeInTheDocument();
    expect(fixture.files.has("BOSL2/std.scad")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Install BOSL2 v2.0.747" }));

    expect(await screen.findByText("Installed v2.0.747")).toBeInTheDocument();
    expect(fixture.files.get("BOSL2/std.scad")).toContain("module cuboid");
    expect(onProjectFilesChanged).toHaveBeenCalledOnce();
  });

  it("removes an installed library while retaining ordinary project files", async () => {
    const user = userEvent.setup();
    const fixture = projectFixture();
    const onProjectFilesChanged = vi.fn(async () => undefined);
    const props = {
      download: vi.fn(async () => packageArchive()),
      onProjectFilesChanged,
      project: fixture.project,
      storage: fixture.storage,
    };
    const view = render(<LibrariesActivity {...props} />);
    const review = screen.getByRole("button", { name: "Review BOSL2 license" });
    await waitFor(() => expect(review).toBeEnabled());
    await user.click(review);
    await user.click(await screen.findByRole("button", { name: "Install BOSL2 v2.0.747" }));
    view.rerender(<LibrariesActivity {...props} />);

    await user.click(await screen.findByRole("button", { name: "Remove BOSL2" }));

    await waitFor(() => expect(
      within(libraryCard("BOSL2"))
        .getByText("Not installed"),
    ).toBeInTheDocument());
    expect(fixture.files.get("main.scad")).toBe("include <BOSL2/std.scad>");
    expect(fixture.files.has("BOSL2/std.scad")).toBe(false);
  });

  it("keeps install controls unavailable for scratch documents", () => {
    const fixture = projectFixture();
    render(
      <LibrariesActivity
        onProjectFilesChanged={vi.fn()}
        project={{ ...fixture.project, mode: "scratch" }}
        storage={fixture.storage}
      />,
    );

    expect(screen.getByText(/Open or create a project/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Review BOSL2 license/ })).not.toBeInTheDocument();
  });
});
