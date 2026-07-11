// @vitest-environment happy-dom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ExportFormat } from "../../../src/application/engine/contracts";
import type {
  ProjectExportCompletion,
  ProjectExportOperation,
} from "../../../src/application/files/project-export";
import { ProjectExportDialog } from "../../../src/ui/files/ProjectExportDialog";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function operation(done: Promise<ProjectExportCompletion>, cancel = vi.fn()): ProjectExportOperation {
  return { jobId: "job", done, cancel };
}

describe("ProjectExportDialog", () => {
  it("defaults a mesh to 3MF and offers every supported format including SVG and DXF", () => {
    const startExport = vi.fn();
    const view = render(
      <ProjectExportDialog
        destinationDescription="Choose a download location"
        entryFile="main.scad"
        startExport={startExport}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Export…" }));

    const dialog = within(view.getByRole("dialog", { name: "Export main.scad" }));
    const picker = dialog.getByRole("combobox", { name: "Format" }) as HTMLSelectElement;
    expect(picker.value).toBe("3mf");
    expect([...picker.options].map(({ value }) => value)).toEqual([
      "3mf", "stl-binary", "stl-ascii", "off", "amf", "svg", "dxf", "png",
    ]);
    expect(dialog.getByText("Choose a download location")).toBeVisible();
  });

  it("opens from the global Export command request", () => {
    const view = render(
      <ProjectExportDialog
        destinationDescription="Downloads"
        entryFile="main.scad"
        openRequest={1}
        startExport={vi.fn()}
      />,
    );

    expect(view.getByRole("dialog", { name: "Export main.scad" })).toBeVisible();
  });

  it("reports no success until saving finishes, then shows destination and mesh facts", async () => {
    const result = deferred<ProjectExportCompletion>();
    const startExport = vi.fn((_format: ExportFormat) => operation(result.promise));
    const view = render(
      <ProjectExportDialog
        destinationDescription="Downloads"
        entryFile="cube.scad"
        startExport={startExport}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Export…" }));
    fireEvent.change(view.getByRole("combobox", { name: "Format" }), {
      target: { value: "stl-binary" },
    });
    fireEvent.click(view.getByRole("button", { name: "Export model" }));

    expect(startExport).toHaveBeenCalledWith("stl-binary");
    expect(view.queryByText(/saved to/iu)).not.toBeInTheDocument();
    expect(view.getByText("Exporting full-quality geometry…")).toBeVisible();

    result.resolve({
      format: "stl-binary",
      location: "Downloads/cube.stl",
      fileName: "cube.stl",
      fileSizeBytes: 684,
      triangleCount: 12,
      boundingBox: { min: [0, 0, 0], max: [10, 10, 10], size: [10, 10, 10] },
      diagnostics: [],
    });
    await waitFor(() => expect(view.getByText("Saved to Downloads/cube.stl")).toBeVisible());
    expect(view.getByText("File size: 684 bytes")).toBeVisible();
    expect(view.getByText("Triangles: 12")).toBeVisible();
    expect(view.getByText("Bounding box: 10 × 10 × 10 mm")).toBeVisible();
  });

  it("shows honest unavailable mesh facts, surfaces failures, and can cancel active work", async () => {
    const first = deferred<ProjectExportCompletion>();
    const second = deferred<ProjectExportCompletion>();
    const cancel = vi.fn();
    const startExport = vi.fn()
      .mockReturnValueOnce(operation(first.promise, cancel))
      .mockReturnValueOnce(operation(second.promise));
    const view = render(
      <ProjectExportDialog
        destinationDescription="Downloads"
        entryFile="cube.scad"
        startExport={startExport}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Export…" }));
    fireEvent.click(view.getByRole("button", { name: "Export model" }));
    fireEvent.click(view.getByRole("button", { name: "Cancel export" }));
    expect(cancel).toHaveBeenCalledOnce();
    first.resolve({
      format: "3mf",
      location: "Downloads/cube.3mf",
      fileName: "cube.3mf",
      fileSizeBytes: 123,
      diagnostics: [],
    });
    await waitFor(() => expect(view.getByText("Triangles: Not reported for this format")).toBeVisible());
    expect(view.getByText("Bounding box: Not reported for this format")).toBeVisible();

    fireEvent.click(view.getByRole("button", { name: "Export model" }));
    second.reject(new Error("Engine unavailable"));
    expect(await view.findByRole("alert")).toHaveTextContent("Engine unavailable");
  });

  it("keeps the originating file and destination attached to an export that is still running", async () => {
    const result = deferred<ProjectExportCompletion>();
    const startA = vi.fn(() => operation(result.promise));
    const view = render(
      <ProjectExportDialog
        destinationDescription="Project A downloads"
        entryFile="a.scad"
        startExport={startA}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: /^Export/ }));
    fireEvent.click(view.getByRole("button", { name: "Export model" }));

    view.rerender(
      <ProjectExportDialog
        destinationDescription="Project B downloads"
        entryFile="b.scad"
        startExport={vi.fn()}
      />,
    );

    expect(view.getByRole("dialog", { name: "Export a.scad" })).toBeVisible();
    expect(view.getByText("Project A downloads")).toBeVisible();
    expect(view.queryByRole("dialog", { name: "Export b.scad" })).not.toBeInTheDocument();
    result.resolve({
      format: "3mf",
      location: "Project A downloads/a.3mf",
      fileName: "a.3mf",
      fileSizeBytes: 123,
      diagnostics: [],
    });
    expect(await view.findByText("Saved to Project A downloads/a.3mf")).toBeVisible();
  });
});
