// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { parseProjectPath } from "../../../src/application/files/project-path";
import type { ModelHistorySnapshot } from "../../../src/application/model-history/model-history";
import { ModelHistoryPanel } from "../../../src/ui/history/ModelHistoryPanel";

function historySnapshot(index: number): ModelHistorySnapshot {
  return {
    snapshotId: `snapshot-${index}`,
    workspaceIdentity: "project-a",
    documentId: "document-main",
    documentPath: parseProjectPath("main.scad"),
    renderIdentity: `sha256:${String(index).repeat(64)}`,
    capturedAt: `2026-07-21T12:00:0${index}.000Z`,
    quality: "full",
    source: `cube(${index});`,
    parameters: { width: index },
    thumbnailPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index]),
  };
}

it("scrubs five snapshots and restores the selected source", () => {
  const restore = vi.fn();
  const view = render(
    <ModelHistoryPanel
      currentSource="cube(5);"
      onRestore={restore}
      snapshots={Array.from({ length: 5 }, (_, index) => historySnapshot(index + 1))}
    />,
  );

  const scrubber = view.getByRole("slider", { name: "Model history snapshot" });
  expect(scrubber).toHaveAttribute("min", "0");
  expect(scrubber).toHaveAttribute("max", "4");
  expect(scrubber).toHaveValue("4");
  fireEvent.change(scrubber, { target: { value: "1" } });

  expect(view.getByRole("img", { name: "Render preview for snapshot 2 of 5" })).toBeVisible();
  expect(view.getByRole("region", { name: "Model history source comparison" })).toHaveTextContent("cube(2);");
  expect(view.getByRole("region", { name: "Model history source comparison" })).toHaveTextContent("cube(5);");
  fireEvent.click(view.getByRole("button", { name: "Restore snapshot 2" }));
  expect(restore).toHaveBeenCalledWith("snapshot-2");
});

it("surfaces restore failures and offers explicit per-project persistence", async () => {
  const setPersistence = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ModelHistoryPanel
      currentSource="cube(2);"
      onPersistenceChange={setPersistence}
      onRestore={vi.fn().mockRejectedValue(new Error("Snapshot is no longer available."))}
      persistence={{ supported: true, enabled: false, status: "ready" }}
      snapshots={[historySnapshot(1)]}
    />,
  );

  fireEvent.click(view.getByRole("checkbox", { name: "Keep model history for this project" }));
  expect(setPersistence).toHaveBeenCalledWith(true);
  fireEvent.click(view.getByRole("button", { name: "Restore snapshot 1" }));
  expect(await view.findByRole("alert")).toHaveTextContent("Snapshot is no longer available.");
});

it("follows new snapshots until the user scrubs away from the latest", async () => {
  const props = { currentSource: "cube(3);", onRestore: vi.fn() };
  const view = render(<ModelHistoryPanel {...props} snapshots={[historySnapshot(1)]} />);
  const scrubber = view.getByRole("slider", { name: "Model history snapshot" });

  view.rerender(
    <ModelHistoryPanel {...props} snapshots={[historySnapshot(1), historySnapshot(2)]} />,
  );
  await waitFor(() => expect(scrubber).toHaveValue("1"));
  fireEvent.change(scrubber, { target: { value: "0" } });
  view.rerender(
    <ModelHistoryPanel
      {...props}
      snapshots={[historySnapshot(1), historySnapshot(2), historySnapshot(3)]}
    />,
  );
  expect(scrubber).toHaveValue("0");
});
