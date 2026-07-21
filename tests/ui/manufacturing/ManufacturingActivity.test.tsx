// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import { ManufacturingActivity } from "../../../src/ui/manufacturing/ManufacturingActivity";

function nonManifoldResult(): RenderSuccess3D {
  const bytes = new Uint8Array(84 + 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  [[0, 0, 0], [10, 0, 0], [0, 10, 0]].forEach((vertex, vertexIndex) => {
    vertex.forEach((value, axis) => {
      view.setFloat32(84 + 12 + vertexIndex * 12 + axis * 4, value, true);
    });
  });
  return {
    kind: "3d",
    mesh: { format: "stl-binary", bytes },
    stats: { engineTimeMs: 1 }, diagnostics: [], rawLog: "",
  };
}

describe("ManufacturingActivity", () => {
  it("requires the last full render and never implies a preview is sufficient", () => {
    const view = render(<ManufacturingActivity quality="preview" result={nonManifoldResult()} />);
    expect(view.getByText(/run a full render/i)).toBeVisible();
    expect(view.getByRole("button", { name: "Run printability check" })).toBeDisabled();
  });

  it("runs the honest AC-15.g report on explicit request", async () => {
    const view = render(<ManufacturingActivity quality="full" result={nonManifoldResult()} />);

    fireEvent.click(view.getByRole("button", { name: "Run printability check" }));

    await waitFor(() => expect(view.getByText("Manifold: FAIL (mesh topology check; 3 boundary edges, 0 non-manifold edges)")).toBeVisible());
    expect(view.getByText(/Overhangs: NOT CHECKED/)).toBeVisible();
    expect(view.container.textContent?.toLowerCase()).not.toContain("print-ready");
  });

  it("lets the user configure build volume and nozzle values", async () => {
    const view = render(<ManufacturingActivity quality="full" result={nonManifoldResult()} />);
    fireEvent.change(view.getByRole("spinbutton", { name: "Build width (mm)" }), { target: { value: "5" } });
    fireEvent.click(view.getByRole("button", { name: "Run printability check" }));
    await waitFor(() => expect(view.getByText(/Build volume: FAIL .*configured 5 × 220 × 250 mm/)).toBeVisible());
  });
});
