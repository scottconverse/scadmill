import { describe, expect, it } from "vitest";

import {
  isParameterValueCompatible,
  parameterValueToSource,
} from "../../../src/application/parameters/customizer-schema";

describe("customizer parameter schema", () => {
  it("accepts and serializes nonempty finite vectors longer than four components", () => {
    const reference = [0, 1, 2, 3, 4, 5] as const;
    const value = [6, 7, 8, 9, 10, 11] as const;

    expect(isParameterValueCompatible(value, reference)).toBe(true);
    expect(parameterValueToSource(value)).toBe("[6, 7, 8, 9, 10, 11]");
  });

  it("retains nonempty, exact-length, and finite-number vector safety", () => {
    const reference = [0, 1, 2, 3, 4, 5] as const;

    expect(isParameterValueCompatible([], [])).toBe(false);
    expect(isParameterValueCompatible([6, 7, 8, 9, 10], reference)).toBe(false);
    expect(isParameterValueCompatible([6, 7, 8, 9, 10, Number.NaN], reference)).toBe(false);
    expect(() => parameterValueToSource([])).toThrow(/non-empty finite numbers/i);
    expect(() => parameterValueToSource([0, 1, Number.POSITIVE_INFINITY])).toThrow(
      /non-empty finite numbers/i,
    );
  });
});
