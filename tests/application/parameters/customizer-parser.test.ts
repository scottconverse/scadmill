import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { extractCustomizerParameters } from "../../../src/application/parameters/customizer-parser";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/customizer/all-annotations.scad", import.meta.url),
);

describe("customizer parameter extraction", () => {
  it("extracts the exact eligible literal assignments and annotation controls in source order", () => {
    const source = readFileSync(fixturePath, "utf8");
    const parameters = extractCustomizerParameters(source);

    expect(
      parameters.map(({ name, defaultValue, group, hidden, description, control }) => ({
        name,
        defaultValue,
        group,
        hidden,
        description,
        control,
      })),
    ).toEqual([
      {
        name: "width",
        defaultValue: 60,
        group: "Dimensions",
        hidden: false,
        description: "Overall width",
        control: { kind: "slider", minimum: 20, maximum: 200, step: 5 },
      },
      {
        name: "depth",
        defaultValue: 40,
        group: "Dimensions",
        hidden: false,
        description: undefined,
        control: { kind: "slider", minimum: 20, maximum: 200 },
      },
      {
        name: "wall",
        defaultValue: 2.4,
        group: "Dimensions",
        hidden: false,
        description: undefined,
        control: { kind: "number", step: 0.1 },
      },
      {
        name: "origin",
        defaultValue: [0, -2.5, 3, 4],
        group: "Dimensions",
        hidden: false,
        description: undefined,
        control: { kind: "vector", length: 4 },
      },
      {
        name: "corner",
        defaultValue: "round",
        group: "Style",
        hidden: false,
        description: undefined,
        control: {
          kind: "dropdown",
          options: [
            { value: "round", label: "Rounded" },
            { value: "square", label: "Square" },
          ],
        },
      },
      {
        name: "material",
        defaultValue: "pla",
        group: "Style",
        hidden: false,
        description: undefined,
        control: {
          kind: "dropdown",
          options: [
            { value: "pla", label: "pla" },
            { value: "petg", label: "petg" },
            { value: "abs", label: "abs" },
          ],
        },
      },
      {
        name: "enabled",
        defaultValue: true,
        group: "Style",
        hidden: false,
        description: undefined,
        control: { kind: "checkbox" },
      },
      {
        name: "title",
        defaultValue: "Storage box",
        group: "Style",
        hidden: false,
        description: "Display name",
        control: { kind: "text" },
      },
      {
        name: "fallback",
        defaultValue: 7,
        group: "Style",
        hidden: false,
        description: undefined,
        control: { kind: "number", step: 1 },
      },
      {
        name: "weights",
        defaultValue: [1, 2, 3, 4, 5],
        group: "Style",
        hidden: false,
        description: undefined,
        control: { kind: "vector", length: 5 },
      },
      {
        name: "$fn",
        defaultValue: 48,
        group: "Hidden",
        hidden: true,
        description: undefined,
        control: { kind: "number", step: 1 },
      },
    ]);
  });

  it("returns stable source ranges for exact in-place rewriting", () => {
    const source = `/* [One] */\r\nvalue_name   =   -12.50e-1; // note\r\ncube(1);`;
    const [parameter] = extractCustomizerParameters(source);

    expect(parameter).toBeDefined();
    expect(source.slice(parameter?.assignmentRange.from, parameter?.assignmentRange.to)).toBe(
      "value_name   =   -12.50e-1;",
    );
    expect(source.slice(parameter?.nameRange.from, parameter?.nameRange.to)).toBe("value_name");
    expect(source.slice(parameter?.valueRange.from, parameter?.valueRange.to)).toBe("-12.50e-1");
    expect(parameter?.defaultSource).toBe("-12.50e-1");
    expect(parameter?.defaultValue).toBe(-1.25);
  });

  it("keeps every numeric component in vectors longer than four values", () => {
    const source = "weights = [1, 2, 3, 4, 5, 6, 7, 8];";
    const [parameter] = extractCustomizerParameters(source);

    expect(parameter).toMatchObject({
      name: "weights",
      defaultValue: [1, 2, 3, 4, 5, 6, 7, 8],
      control: { kind: "vector", length: 8 },
    });
    expect(parameter?.componentRanges?.map(({ from, to }) => source.slice(from, to))).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8",
    ]);
  });

  it("ignores braces in strings/comments and stops at the first structural geometry boundary", () => {
    const source = `// { comment\nlabel = "{";\n/* still } text */\nsize = 3;\nif (true) cube(size);\nlater = 4;`;

    expect(extractCustomizerParameters(source).map(({ name }) => name)).toEqual(["label", "size"]);
  });
});
