import { describe, expect, it } from "vitest";
import { recordRecentProject } from "../../../src/application/files/recent-projects";

describe("recent projects", () => {
  it("deduplicates by stable project id, moves the entry to the front, and caps history", () => {
    const existing = Array.from({ length: 10 }, (_, index) => ({
      projectId: `project-${index}`,
      workspaceIdentity: `workspace-${index}`,
      displayName: `Project ${index}`,
      openedAt: `2026-07-10T00:00:${String(index).padStart(2, "0")}Z`,
    }));

    const updated = recordRecentProject(existing, {
      projectId: "project-5",
      workspaceIdentity: "workspace-renamed",
      displayName: "Renamed project",
      openedAt: "2026-07-10T22:00:00Z",
    });

    expect(updated).toHaveLength(10);
    expect(updated[0]).toEqual({
      projectId: "project-5",
      workspaceIdentity: "workspace-renamed",
      displayName: "Renamed project",
      openedAt: "2026-07-10T22:00:00Z",
    });
    expect(updated.filter(({ projectId }) => projectId === "project-5")).toHaveLength(1);
    expect(new Set(updated.map(({ projectId }) => projectId)).size).toBe(10);
    expect(updated.some(({ projectId }) => projectId === "project-9")).toBe(true);
    expect(existing[5].displayName).toBe("Project 5");
  });

  it("rejects non-finite or non-positive limits", () => {
    const entry = { projectId: "project-1", workspaceIdentity: "workspace-1", displayName: "One", openedAt: "now" };
    expect(() => recordRecentProject([], entry, 0)).toThrow(/positive integer/i);
    expect(() => recordRecentProject([], entry, Number.NaN)).toThrow(/positive integer/i);
  });

  it("rejects an empty workspace identity", () => {
    expect(() => recordRecentProject([], {
      projectId: "project-1",
      workspaceIdentity: " ",
      displayName: "One",
      openedAt: "now",
    })).toThrow(/workspace identity/iu);
  });
});
