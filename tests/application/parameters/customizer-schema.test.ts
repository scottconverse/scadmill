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

  it("rejects a fully sparse same-length vector for compatibility and serialization", () => {
    const reference = [0, 1, 2, 3, 4, 5] as const;
    const sparse = new Array<number>(reference.length);

    expect.soft(isParameterValueCompatible(sparse, reference)).toBe(false);
    expect(() => parameterValueToSource(sparse)).toThrow(/non-empty finite numbers/i);
  });

  it("rejects a partially sparse same-length vector for compatibility and serialization", () => {
    const reference = [0, 1, 2, 3, 4, 5] as const;
    const sparse = [6, 7, 8, 9, 10, 11];
    delete sparse[2];
    const inherited = Object.create(Array.prototype) as Record<number, number>;
    inherited[2] = 8;
    Object.setPrototypeOf(sparse, inherited);

    expect(Object.hasOwn(sparse, 2)).toBe(false);
    expect.soft(isParameterValueCompatible(sparse, reference)).toBe(false);
    expect(() => parameterValueToSource(sparse)).toThrow(/non-empty finite numbers/i);
  });

  it("rejects a sparse vector reference even when the candidate is dense and same-length", () => {
    const sparseReference = new Array<number>(6);

    expect(isParameterValueCompatible([6, 7, 8, 9, 10, 11], sparseReference)).toBe(false);
  });
});
