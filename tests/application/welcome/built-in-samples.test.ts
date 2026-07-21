import { describe, expect, it } from "vitest";

import { extractCustomizerParameters } from "../../../src/application/parameters/customizer-parser";
import { BUILT_IN_SAMPLES } from "../../../src/application/welcome/built-in-samples";

describe("built-in welcome samples", () => {
  it("ships the three normative Appendix F models with their exact public parameter names", () => {
    expect(BUILT_IN_SAMPLES.map(({ id, path }) => ({ id, path }))).toEqual([
      { id: "parametric-box", path: "parametric_box.scad" },
      { id: "gear-knob", path: "gear_knob.scad" },
      { id: "mounting-plate", path: "mounting_plate.scad" },
    ]);
    expect(BUILT_IN_SAMPLES.map(({ source }) => source.endsWith("\n"))).toEqual([true, true, true]);

    const visibleNames = BUILT_IN_SAMPLES.map(({ source }) =>
      extractCustomizerParameters(source).filter(({ hidden }) => !hidden).map(({ name }) => name)
    );
    expect(visibleNames).toEqual([
      ["width", "depth", "height", "wall", "corner", "corner_radius", "with_lid"],
      ["knob_diameter", "knob_height", "ridges", "ridge_depth", "bore_diameter", "d_flat"],
      ["plate_width", "plate_height", "fillet", "hole_diameter", "hole_margin", "center_slot"],
    ]);
  });

  it("keeps the 2D sample genuinely two-dimensional and the two 3D samples explicit", () => {
    expect(BUILT_IN_SAMPLES.map(({ dimension }) => dimension)).toEqual(["3d", "3d", "2d"]);
    expect(BUILT_IN_SAMPLES[0].source).toContain("box();");
    expect(BUILT_IN_SAMPLES[1].source).toContain("difference() {\n    knob_body();");
    expect(BUILT_IN_SAMPLES[2].source.trimEnd().endsWith("if (center_slot) slot();\n}"))
      .toBe(true);
  });
});
