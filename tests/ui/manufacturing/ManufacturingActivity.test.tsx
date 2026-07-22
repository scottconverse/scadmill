// @vitest-environment happy-dom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { RenderSuccess3D } from "../../../src/application/engine/contracts";
import {
  KIRI_MOTO_VERSION,
  MANUFACTURING_ESTIMATE_PROFILES,
} from "../../../src/application/manufacturing/manufacturing-estimate";
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

function coloredThreeMfResult(): RenderSuccess3D {
  const model = `<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" unit="millimeter"><resources><m:colorgroup id="3"><m:color color="#FF0000FF"/><m:color color="#0000FFFF"/></m:colorgroup><object id="1" name="Red" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" pid="3" p1="0"/></triangles></mesh></object><object id="2" name="Blue" type="model"><mesh><vertices><vertex x="20" y="0" z="0"/><vertex x="30" y="0" z="0"/><vertex x="20" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" pid="3" p1="1"/></triangles></mesh></object></resources><build><item objectid="1"/><item objectid="2"/></build></model>`;
  return {
    kind: "3d",
    mesh: {
      format: "3mf",
      bytes: zipSync({ "3D/3dmodel.model": strToU8(model) }),
      parts: [
        { id: "1", name: "Red", color: "#FF0000", triangleOffset: 0, triangleCount: 1 },
        { id: "2", name: "Blue", color: "#0000FF", triangleOffset: 1, triangleCount: 1 },
      ],
    },
    stats: { engineTimeMs: 1 }, diagnostics: [], rawLog: "",
  };
}

describe("ManufacturingActivity", () => {
  it("requires the last full render and never implies a preview is sufficient", () => {
    const view = render(<ManufacturingActivity quality="preview" result={nonManifoldResult()} />);
    expect(view.getAllByText(/run a full render/i)).toHaveLength(2);
    expect(view.getByRole("button", { name: "Run printability check" })).toBeDisabled();
    expect(view.getByRole("button", { name: "Estimate print time and filament" })).toBeDisabled();
  });

  it("runs the honest AC-15.g report on explicit request", async () => {
    const view = render(<ManufacturingActivity quality="full" result={nonManifoldResult()} />);

    fireEvent.click(view.getByRole("button", { name: "Run printability check" }));

    await waitFor(() => expect(view.getByText("Manifold: FAIL (mesh topology check; 3 boundary edges, 0 non-manifold edges)")).toBeVisible());
    expect(view.getByText(/Overhangs: NOT CHECKED/)).toBeVisible();
    expect(view.container.textContent?.toLowerCase()).not.toContain("print-ready");
  });

  it("checks a full colored 3MF and derives the multi-object slicer warning", async () => {
    const view = render(<ManufacturingActivity quality="full" result={coloredThreeMfResult()} />);

    expect(view.getByRole("button", { name: "Run printability check" })).toBeEnabled();
    expect(view.getByText(/assign filaments per object in your slicer/i)).toBeVisible();
    fireEvent.click(view.getByRole("button", { name: "Run printability check" }));

    await waitFor(() => expect(view.getByText("Manifold: FAIL (mesh topology check; 6 boundary edges, 0 non-manifold edges)")).toBeVisible());
  });

  it("runs the AC-15.n design-time estimate only on explicit request with honest labels", async () => {
    const profile = MANUFACTURING_ESTIMATE_PROFILES[0];
    const estimateRunner = vi.fn(async () => ({
      engineName: "Kiri:Moto" as const,
      engineVersion: KIRI_MOTO_VERSION,
      profileId: profile.id,
      profileName: profile.name,
      timeSeconds: 1765.5459577924212,
      filamentMillimeters: 1560.5689130488631,
    }) as const);
    const view = render(
      <ManufacturingActivity
        estimateRunner={estimateRunner}
        quality="full"
        result={nonManifoldResult()}
      />,
    );

    expect(estimateRunner).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Estimate print time and filament" }));

    expect(await view.findByText("Estimated print time: 29 min 26 sec")).toBeVisible();
    expect(view.getByText("Estimated filament use: 1.56 m")).toBeVisible();
    expect(estimateRunner).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "stl-binary",
      profile.id,
      expect.any(AbortSignal),
    );
    const copy = view.container.textContent?.toLowerCase() ?? "";
    expect(copy).toContain("estimate");
    expect(copy).toContain("kiri:moto 4.7.1");
    expect(copy).toContain(profile.name.toLowerCase());
    expect(copy).toContain("generic profile");
    expect(copy).toContain("real slicer settings or printer tuning");
    expect(copy).not.toContain("print-ready");
  });

  it("lets the user select a generic estimate profile and reports failures", async () => {
    const estimateRunner = vi.fn(async () => { throw new Error("slice failed"); });
    const selected = MANUFACTURING_ESTIMATE_PROFILES[1];
    const view = render(
      <ManufacturingActivity
        estimateRunner={estimateRunner}
        quality="full"
        result={nonManifoldResult()}
      />,
    );
    fireEvent.change(view.getByRole("combobox", { name: "Generic machine profile" }), {
      target: { value: selected.id },
    });
    fireEvent.click(view.getByRole("button", { name: "Estimate print time and filament" }));

    await waitFor(() => expect(estimateRunner).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "stl-binary",
      selected.id,
      expect.any(AbortSignal),
    ));
    expect(await view.findByRole("alert")).toHaveTextContent(/estimate could not complete/i);
  });

  it("removes an estimate when its full-render source is replaced", async () => {
    const profile = MANUFACTURING_ESTIMATE_PROFILES[0];
    const estimateRunner = vi.fn(async () => ({
      engineName: "Kiri:Moto" as const,
      engineVersion: KIRI_MOTO_VERSION,
      profileId: profile.id,
      profileName: profile.name,
      timeSeconds: 60,
      filamentMillimeters: 100,
    }) as const);
    const initialResult = nonManifoldResult();
    const view = render(
      <ManufacturingActivity
        estimateRunner={estimateRunner}
        quality="full"
        result={initialResult}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Estimate print time and filament" }));
    expect(await view.findByText("Estimated print time: 1 min")).toBeVisible();

    view.rerender(
      <ManufacturingActivity
        estimateRunner={estimateRunner}
        quality="full"
        result={nonManifoldResult()}
      />,
    );

    await waitFor(() => expect(view.queryByText(/^Estimated print time:/)).not.toBeInTheDocument());
  });

  it("lets the user configure build volume and nozzle values", async () => {
    const view = render(<ManufacturingActivity quality="full" result={nonManifoldResult()} />);
    fireEvent.change(view.getByRole("spinbutton", { name: "Build width (mm)" }), { target: { value: "5" } });
    fireEvent.click(view.getByRole("button", { name: "Run printability check" }));
    await waitFor(() => expect(view.getByText(/Build volume: FAIL .*configured 5 × 220 × 250 mm/)).toBeVisible());
  });

  it("launches a detected or explicitly configured desktop slicer with honest handoff copy", async () => {
    const open = vi.fn(async () => ({ slicerName: "OrcaSlicer", temporaryFile: "C:/Temp/main.3mf" }));
    const view = render(<ManufacturingActivity multiObject onOpenInSlicer={open} />);
    fireEvent.change(view.getByRole("textbox", { name: "Optional slicer executable" }), {
      target: { value: " C:/Tools/orca-slicer.exe " },
    });
    fireEvent.click(view.getByRole("button", { name: "Open in slicer" }));

    await waitFor(() => expect(open).toHaveBeenCalledWith("C:/Tools/orca-slicer.exe"));
    expect(await view.findByText("Opened the exported 3MF in OrcaSlicer.")).toBeVisible();
    expect(view.getByText(/assign filaments per object in your slicer/i)).toBeVisible();
  });

  it("keeps slicer handoff unavailable outside the desktop composition", () => {
    const view = render(<ManufacturingActivity />);
    expect(view.getByRole("button", { name: "Open in slicer" })).toBeDisabled();
    expect(view.getByText(/desktop app only/i)).toBeVisible();
  });
});
