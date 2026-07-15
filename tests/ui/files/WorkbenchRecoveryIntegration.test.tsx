// @vitest-environment happy-dom
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineService } from "../../../src/application/engine/contracts";
import type { ProjectStorage } from "../../../src/application/files/project-file-service";
import {
  createProjectSnapshot,
  type ProjectFileContent,
} from "../../../src/application/files/project-snapshot";
import type { RecoveryPersistence } from "../../../src/application/files/recovery-state";
import { createWorkbenchRuntime } from "../../../src/application/runtime/workbench-runtime";
import { SHIPPED_THEMES } from "../../../src/application/theme/shipped-themes";
import { messages } from "../../../src/messages/en";
import { Workbench } from "../../../src/ui/Workbench";

function engine(): EngineService {
  return { render: vi.fn(), export: vi.fn(), version: vi.fn(), cancel: vi.fn() };
}

describe("Workbench recovery ownership", () => {
  it("blocks the visible Files project controls while the session host owns pending recovery", async () => {
    const serializedRecovery = JSON.stringify({
      version: 1,
      projectId: "scratch",
      capturedAt: "2026-07-10T00:00:00.000Z",
      buffers: [{
        documentId: "document-main",
        path: "main.scad",
        source: "cube(77);",
        savedSource: "cube(12);",
      }],
    });
    const recoveryPersistence: RecoveryPersistence = {
      load: () => serializedRecovery,
      save: () => undefined,
      clear: () => undefined,
    };
    const files = new Map<string, ProjectFileContent>([["main.scad", "sphere(5);"]]);
    const snapshot = vi.fn(async (projectId: string) => createProjectSnapshot(projectId, files));
    const storage: ProjectStorage = {
      snapshot,
      read: async (_projectId, path) => files.get(path),
      write: async (_projectId, path, content) => { files.set(path, content); },
      move: async () => undefined,
      trash: async () => undefined,
      reveal: async () => undefined,
    };
    const runtime = createWorkbenchRuntime(engine(), {
      projectStorage: storage,
      recentProjectsPersistence: {
        load: () => [{
          projectId: "project-b",
          displayName: "Project B",
          openedAt: "2026-07-10T00:00:00.000Z",
        }],
        save: () => undefined,
      },
    });
    const view = render(
      <Workbench
        activeTheme={SHIPPED_THEMES[0]}
        engine={engine()}
        engineLabel="OpenSCAD test engine"
        projectStorage={storage}
        recoveryPersistence={recoveryPersistence}
        runtime={runtime}
        themePreference="system"
        onThemePreferenceChange={vi.fn()}
      />,
    );
    const filesPanel = within(view.getByRole("region", { name: messages.projectFiles }));
    const folderInput = filesPanel.getByLabelText(messages.browserProjectName);
    const openProject = filesPanel.getByRole("button", { name: messages.openProject });
    const reopenProject = filesPanel.getByRole("button", { name: messages.reopenProject("Project B") });

    fireEvent.change(folderInput, { target: { value: "project-b" } });
    fireEvent.click(openProject);
    fireEvent.click(reopenProject);
    await act(async () => { await Promise.resolve(); });

    expect(folderInput).toBeDisabled();
    expect(openProject).toBeDisabled();
    expect(reopenProject).toBeDisabled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(view.getByRole("region", { name: messages.recoveryTitle })).toBeVisible();
    expect(view.queryByRole("dialog", { name: messages.confirmProjectReplacement }))
      .not.toBeInTheDocument();

    fireEvent.click(view.getByRole("button", { name: messages.discardRecovery }));
    await waitFor(() => expect(openProject).not.toBeDisabled());
    expect(folderInput).not.toBeDisabled();
    expect(reopenProject).not.toBeDisabled();
  });
});
