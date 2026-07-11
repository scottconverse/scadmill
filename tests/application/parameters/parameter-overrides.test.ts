import { describe, expect, it } from "vitest";

import { extractCustomizerParameters } from "../../../src/application/parameters/customizer-parser";
import {
  reconcileParameterOverrides,
  writeParameterValues,
} from "../../../src/application/parameters/parameter-overrides";

describe("customizer parameter overrides", () => {
  it("preserves compatible overrides by surviving name and drops renamed or incompatible values", () => {
    const parameters = extractCustomizerParameters(
      `width = 10; enabled = false; label = "old"; point = [0, 1]; renamed = 3; cube(width);`,
    );

    expect(
      reconcileParameterOverrides(parameters, {
        width: 25,
        enabled: true,
        label: "new",
        point: [4, 5],
        renamed: "wrong type",
        removed: 99,
      }),
    ).toEqual({ width: 25, enabled: true, label: "new", point: [4, 5] });
  });

  it("rewrites only selected right-hand sides while preserving all other bytes", () => {
    const source = `/* [Size] */\r\nwidth = 60;        // [20:200]\r\nname = "Box"; // label\r\nenabled=true;\r\npoint = [0, 1];\r\ncube(width);`;
    const parameters = extractCustomizerParameters(source);

    expect(
      writeParameterValues(source, parameters, {
        width: 72.5,
        name: 'A "quoted" box',
        enabled: false,
        point: [-1, 2.25],
        absent: 200,
      }),
    ).toBe(`/* [Size] */\r\nwidth = 72.5;        // [20:200]\r\nname = "A \\"quoted\\" box"; // label\r\nenabled=false;\r\npoint = [-1, 2.25];\r\ncube(width);`);
  });

  it("rewrites vector component tokens without deleting inline comments or spacing", () => {
    const source = "point = [1.0, /* keep x */  2]; cube(point);";
    const parameters = extractCustomizerParameters(source);

    expect(writeParameterValues(source, parameters, { point: [1, 4] })).toBe(
      "point = [1.0, /* keep x */  4]; cube(point);",
    );
  });

  it("rewrites changed tokens in a six-component vector while preserving untouched token bytes", () => {
    const source = "pose = [1.0, /* keep x */  2, 3, 4, /* keep tail */  5, 6.0]; cube(1);";
    const parameters = extractCustomizerParameters(source);

    expect(writeParameterValues(source, parameters, { pose: [1, 2, 3, 4, 50, 60] })).toBe(
      "pose = [1.0, /* keep x */  2, 3, 4, /* keep tail */  50, 60]; cube(1);",
    );
  });

  it("keeps identifier-shaped prototype keys as inert own properties", () => {
    const parameters = extractCustomizerParameters(`__proto__ = [0, 1]; cube(1);`);
    const previous = JSON.parse('{"__proto__":[2,3]}') as Record<string, readonly number[]>;
    const reconciled = reconcileParameterOverrides(parameters, previous);

    expect(Object.getPrototypeOf(reconciled)).toBe(Object.prototype);
    expect(Object.hasOwn(reconciled, "__proto__")).toBe(true);
    expect(Reflect.get(reconciled, "__proto__")).toEqual([2, 3]);
  });

  it("rejects non-finite and type-incompatible write values", () => {
    const source = `width = 60; point = [0, 1]; cube(width);`;
    const parameters = extractCustomizerParameters(source);

    expect(() => writeParameterValues(source, parameters, { width: Number.NaN })).toThrow(
      "width",
    );
    expect(() => writeParameterValues(source, parameters, { point: [0, Number.POSITIVE_INFINITY] }))
      .toThrow("point");
    expect(() => writeParameterValues(source, parameters, { width: "wide" })).toThrow("width");

    const longVectorSource = "pose = [0, 1, 2, 3, 4, 5]; cube(1);";
    const longVectorParameters = extractCustomizerParameters(longVectorSource);
    expect(() => writeParameterValues(longVectorSource, longVectorParameters, {
      pose: [6, 7, 8, 9, 10],
    })).toThrow("pose");
    expect(() => writeParameterValues(longVectorSource, longVectorParameters, {
      pose: [6, 7, 8, 9, 10, Number.NaN],
    })).toThrow("pose");
  });

  it("refuses stale source ranges after the document changes", () => {
    const parameters = extractCustomizerParameters(`width = 60; cube(width);`);

    expect(() =>
      writeParameterValues(`width = 70; cube(width);`, parameters, { width: 80 }),
    ).toThrow("current document");
  });
});
