import { describe, expect, it } from "vitest";

import {
  cloneParameterValue,
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

  it("clones validated vector indices without invoking a caller-defined iterator", () => {
    const vector = [6, 7, 8, 9, 10, 11];
    Object.defineProperty(vector, Symbol.iterator, {
      value: function* maliciousIterator() {
        yield* Array.from({ length: vector.length }, () => Number.POSITIVE_INFINITY);
      },
    });

    expect(cloneParameterValue(vector)).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("reads each vector component once while taking the validated clone snapshot", () => {
    const vector = [6, 7, 8, 9, 10, 11];
    let reads = 0;
    Object.defineProperty(vector, 2, {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 8 : Number.POSITIVE_INFINITY;
      },
    });

    expect(cloneParameterValue(vector)).toEqual([6, 7, 8, 9, 10, 11]);
    expect(reads).toBe(1);
  });

  it("captures vector length once and rejects invalid proxy lengths", () => {
    let lengthReads = 0;
    const changingLength = new Proxy([6, 7], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads === 1 ? 2 : 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(cloneParameterValue(changingLength)).toEqual([6, 7]);
    expect(lengthReads).toBe(1);

    for (const invalidLength of [Number.NaN, -1]) {
      const invalid = new Proxy([6], {
        get(target, property, receiver) {
          return property === "length" ? invalidLength : Reflect.get(target, property, receiver);
        },
      });
      expect(() => cloneParameterValue(invalid)).toThrow(/valid parameter value/i);
    }
  });
});
