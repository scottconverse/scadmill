import { describe, expect, it } from "vitest";
import {
  encodeParameterSets,
  type NamedParameterSet,
} from "../../../src/application/parameters/parameter-set-codec";
import {
  createParameterState,
  parameterDocument,
  reduceParameterState,
} from "../../../src/application/parameters/parameter-state";

const sparseSetVector = [6, 7, 8, 9, 10, 11];
delete sparseSetVector[2];

describe("per-document customizer state", () => {
  it("snapshots a runtime vector once before compatibility and storage", () => {
    let lengthReads = 0;
    const changingLength = new Proxy([6, 7], {
      get(target, property, receiver) {
        if (property === "length") {
          lengthReads += 1;
          return lengthReads < 5 ? 2 : 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    let state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "pose = [0, 1]; cube(1);",
    }]);

    state = reduceParameterState(state, {
      kind: "set-value",
      documentId: "doc-a",
      name: "pose",
      value: changingLength,
    });

    expect(parameterDocument(state, "doc-a").overrides.pose).toEqual([6, 7]);
    expect(lengthReads).toBe(1);
  });

  it("edits, saves, and reapplies a six-component vector as one exact value", () => {
    let state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "pose = [0, 1, 2, 3, 4, 5]; cube(1);",
    }]);
    const edited = [6, 7, 8, 9, 10, 11] as const;

    state = reduceParameterState(state, {
      kind: "set-value",
      documentId: "doc-a",
      name: "pose",
      value: edited,
    });
    expect(parameterDocument(state, "doc-a").overrides).toEqual({ pose: edited });

    state = reduceParameterState(state, {
      kind: "save-set",
      documentId: "doc-a",
      name: "Moved",
    });
    state = reduceParameterState(state, { kind: "reset-all", documentId: "doc-a" });
    state = reduceParameterState(state, {
      kind: "apply-set",
      documentId: "doc-a",
      name: "Moved",
    });

    expect(parameterDocument(state, "doc-a").overrides).toEqual({ pose: edited });
  });

  it("reparses each accepted revision, preserves compatible names, and drops renamed values", () => {
    let state = createParameterState([
      { documentId: "doc-a", revision: 0, source: "width = 10; enabled = true; cube(width);" },
    ]);
    state = reduceParameterState(state, {
      kind: "set-value",
      documentId: "doc-a",
      name: "width",
      value: 25,
    });
    state = reduceParameterState(state, {
      kind: "set-value",
      documentId: "doc-a",
      name: "enabled",
      value: false,
    });
    state = reduceParameterState(state, {
      kind: "sync-source",
      documentId: "doc-a",
      revision: 1,
      source: "renamed = 10; enabled = true; cube(renamed);",
    });

    const document = parameterDocument(state, "doc-a");
    expect(document.parameters.map(({ name }) => name)).toEqual(["renamed", "enabled"]);
    expect(document.overrides).toEqual({ enabled: false });
    expect(document.revision).toBe(1);
  });

  it("resets one or all overrides and treats a source-default value as reset", () => {
    let state = createParameterState([
      { documentId: "doc-a", revision: 0, source: "width = 10; depth = 20; cube(width);" },
    ]);
    state = reduceParameterState(state, { kind: "set-value", documentId: "doc-a", name: "width", value: 15 });
    state = reduceParameterState(state, { kind: "set-value", documentId: "doc-a", name: "depth", value: 30 });
    state = reduceParameterState(state, { kind: "reset-value", documentId: "doc-a", name: "width" });
    expect(parameterDocument(state, "doc-a").overrides).toEqual({ depth: 30 });
    state = reduceParameterState(state, { kind: "set-value", documentId: "doc-a", name: "depth", value: 20 });
    expect(parameterDocument(state, "doc-a").overrides).toEqual({});
    state = reduceParameterState(state, { kind: "set-value", documentId: "doc-a", name: "width", value: 18 });
    state = reduceParameterState(state, { kind: "reset-all", documentId: "doc-a" });
    expect(parameterDocument(state, "doc-a").overrides).toEqual({});
  });

  it("saves, applies, renames, and deletes named parameter sets", () => {
    let state = createParameterState([
      { documentId: "doc-a", revision: 0, source: "width = 10; depth = 20; cube(width);" },
    ]);
    state = reduceParameterState(state, { kind: "set-value", documentId: "doc-a", name: "width", value: 40 });
    state = reduceParameterState(state, { kind: "save-set", documentId: "doc-a", name: "Wide" });
    state = reduceParameterState(state, { kind: "reset-all", documentId: "doc-a" });
    state = reduceParameterState(state, { kind: "apply-set", documentId: "doc-a", name: "Wide" });
    expect(parameterDocument(state, "doc-a").overrides).toEqual({ width: 40 });
    state = reduceParameterState(state, { kind: "rename-set", documentId: "doc-a", from: "Wide", to: "Forty" });
    expect(parameterDocument(state, "doc-a").sets.map(({ name }) => name)).toEqual(["Forty"]);
    state = reduceParameterState(state, { kind: "delete-set", documentId: "doc-a", name: "Forty" });
    expect(parameterDocument(state, "doc-a").sets).toEqual([]);
  });

  it("stores Hidden values but does not retrieve them when applying a set", () => {
    let state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "width = 10; /* [Hidden] */ secret = 7; cube(width);",
    }]);
    state = reduceParameterState(state, {
      kind: "save-set",
      documentId: "doc-a",
      name: "Stored",
    });
    expect(parameterDocument(state, "doc-a").sets[0]?.values).toEqual({ width: 10, secret: 7 });

    state = reduceParameterState(state, {
      kind: "replace-sets",
      documentId: "doc-a",
      sets: [{ name: "Imported", values: { width: 25, secret: 99 } }],
    });
    state = reduceParameterState(state, {
      kind: "apply-set",
      documentId: "doc-a",
      name: "Imported",
    });

    expect(parameterDocument(state, "doc-a").overrides).toEqual({ width: 25 });

    state = reduceParameterState(state, {
      kind: "sync-source",
      documentId: "doc-a",
      revision: 1,
      source: "width = 10; secret = 7; cube(width);",
    });
    state = reduceParameterState(state, {
      kind: "apply-set",
      documentId: "doc-a",
      name: "Imported",
    });
    expect(parameterDocument(state, "doc-a").overrides).toEqual({ width: 25, secret: 99 });
  });

  it("owns replaced-set vector values after the caller mutates its imported records", () => {
    const values = JSON.parse(
      '{"pose":[6,7,8,9,10,11],"width":12,"__proto__":[1,2,3,4,5,6]}',
    ) as Record<string, number | number[]>;
    let state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "pose = [0, 1, 2, 3, 4, 5]; width = 1; __proto__ = [0, 1, 2, 3, 4, 5]; cube(1);",
    }]);
    state = reduceParameterState(state, {
      kind: "replace-sets",
      documentId: "doc-a",
      sets: [{ name: "Imported", values }],
    });

    const callerPose = values.pose;
    const callerPrototype = Reflect.get(values, "__proto__");
    if (!Array.isArray(callerPose) || !Array.isArray(callerPrototype)) {
      throw new TypeError("Test fixture vectors are missing.");
    }
    callerPose[5] = 99;
    callerPrototype[0] = 99;
    values.width = 99;

    const stored = parameterDocument(state, "doc-a").sets[0]?.values;
    expect(stored).toEqual(JSON.parse(
      '{"pose":[6,7,8,9,10,11],"width":12,"__proto__":[1,2,3,4,5,6]}',
    ));
    expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
    expect(Object.hasOwn(stored ?? {}, "__proto__")).toBe(true);
    expect(JSON.parse(encodeParameterSets(parameterDocument(state, "doc-a").sets)))
      .toEqual(JSON.parse(
        '{"parameterSets":{"Imported":{"pose":"[6, 7, 8, 9, 10, 11]","width":"12","__proto__":"[1, 2, 3, 4, 5, 6]"}},"fileFormatVersion":"1"}',
      ));
  });

  it("snapshots each replaced set name and value map exactly once", () => {
    let nameReads = 0;
    let valuesReads = 0;
    const firstValues: Readonly<Record<string, number>> = { width: 20 };
    const changedValues: Readonly<Record<string, number>> = { "bad-name": 30 };
    const changingSet: NamedParameterSet = {
      get name() {
        nameReads += 1;
        return nameReads === 1 ? "Snapshot" : "Duplicate";
      },
      get values() {
        valuesReads += 1;
        return valuesReads === 1 ? firstValues : changedValues;
      },
    };
    const state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "width = 10; cube(width);",
    }]);
    let next = state;

    expect(() => {
      next = reduceParameterState(state, {
        kind: "replace-sets",
        documentId: "doc-a",
        sets: [changingSet, { name: "Duplicate", values: { width: 30 } }],
      });
    }).not.toThrow();
    expect(nameReads).toBe(1);
    expect(valuesReads).toBe(1);
    expect(parameterDocument(next, "doc-a").sets).toEqual([
      { name: "Snapshot", values: { width: 20 } },
      { name: "Duplicate", values: { width: 30 } },
    ]);
  });

  it.each([
    ["a sparse vector", sparseSetVector],
    ["a non-finite vector", [6, 7, 8, 9, 10, Number.POSITIVE_INFINITY]],
    ["a non-finite scalar", Number.NaN],
  ] as const)("rejects a runtime replace-sets action containing %s", (_caseName, invalidValue) => {
    const state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "pose = [0, 1, 2, 3, 4, 5]; cube(1);",
    }]);

    expect(() => reduceParameterState(state, {
      kind: "replace-sets",
      documentId: "doc-a",
      sets: [{ name: "Invalid", values: { pose: invalidValue } }],
    })).toThrow(/valid parameter value/i);
    expect(parameterDocument(state, "doc-a").sets).toEqual([]);
  });

  it.each([
    ["an empty set name", [{ name: "   ", values: { width: 20 } }]],
    [
      "duplicate set names",
      [
        { name: "Duplicate", values: { width: 20 } },
        { name: "Duplicate", values: { width: 30 } },
      ],
    ],
    ["an invalid parameter name", [{ name: "Invalid", values: { "bad-name": 20 } }]],
  ] satisfies readonly (readonly [string, readonly NamedParameterSet[]])[])(
    "rejects a runtime replace-sets action containing %s without changing existing sets",
    (_caseName, sets) => {
      let state = createParameterState([{
        documentId: "doc-a",
        revision: 0,
        source: "width = 10; cube(width);",
      }]);
      state = reduceParameterState(state, {
        kind: "save-set",
        documentId: "doc-a",
        name: "Existing",
      });
      const before = parameterDocument(state, "doc-a");

      expect(() => reduceParameterState(state, {
        kind: "replace-sets",
        documentId: "doc-a",
        sets,
      })).toThrow(/invalid|duplicate/i);
      expect(parameterDocument(state, "doc-a")).toBe(before);
      expect(before.sets).toEqual([{ name: "Existing", values: { width: 10 } }]);
    },
  );

  it("keeps forward-compatible set data and safely ignores stale members after a source edit", () => {
    let state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "width = 10; cube(width);",
    }]);
    state = reduceParameterState(state, {
      kind: "set-value",
      documentId: "doc-a",
      name: "width",
      value: 25,
    });
    state = reduceParameterState(state, {
      kind: "save-set",
      documentId: "doc-a",
      name: "Wide",
    });
    state = reduceParameterState(state, {
      kind: "sync-source",
      documentId: "doc-a",
      revision: 1,
      source: 'title = "box"; cube(10);',
    });

    expect(parameterDocument(state, "doc-a").selectedSet).toBeUndefined();
    expect(parameterDocument(state, "doc-a").sets[0]?.values).toEqual({ width: 25 });
    expect(() => {
      state = reduceParameterState(state, {
        kind: "apply-set",
        documentId: "doc-a",
        name: "Wide",
      });
    }).not.toThrow();
    expect(parameterDocument(state, "doc-a").overrides).toEqual({});
  });

  it("drops a live override when its parameter moves into Hidden", () => {
    let state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "width = 10; cube(width);",
    }]);
    state = reduceParameterState(state, {
      kind: "set-value",
      documentId: "doc-a",
      name: "width",
      value: 25,
    });
    state = reduceParameterState(state, {
      kind: "sync-source",
      documentId: "doc-a",
      revision: 1,
      source: "/* [Hidden] */ width = 10; cube(width);",
    });

    expect(parameterDocument(state, "doc-a").overrides).toEqual({});
  });

  it("drops a live override when a source edit adopts it as the new default", () => {
    let state = createParameterState([{
      documentId: "doc-a",
      revision: 0,
      source: "width = 10; cube(width);",
    }]);
    state = reduceParameterState(state, {
      kind: "set-value",
      documentId: "doc-a",
      name: "width",
      value: 20,
    });
    state = reduceParameterState(state, {
      kind: "sync-source",
      documentId: "doc-a",
      revision: 1,
      source: "width = 20; cube(width);",
    });

    expect(parameterDocument(state, "doc-a").overrides).toEqual({});
  });

  it("rejects unknown parameters, incompatible values, duplicate sets, and stale revisions", () => {
    const state = createParameterState([
      { documentId: "doc-a", revision: 2, source: "width = 10; cube(width);" },
    ]);
    expect(() => reduceParameterState(state, { kind: "set-value", documentId: "doc-a", name: "missing", value: 1 })).toThrow(/unknown/i);
    expect(() => reduceParameterState(state, { kind: "set-value", documentId: "doc-a", name: "width", value: "wide" })).toThrow(/compatible/i);
    expect(
      reduceParameterState(state, {
        kind: "sync-source",
        documentId: "doc-a",
        revision: 1,
        source: "older = 1;",
      }),
    ).toBe(state);

    const hiddenState = createParameterState([{
      documentId: "doc-hidden",
      revision: 0,
      source: "/* [Hidden] */ secret = 7; cube(1);",
    }]);
    expect(() => reduceParameterState(hiddenState, {
      kind: "set-value",
      documentId: "doc-hidden",
      name: "secret",
      value: 9,
    })).toThrow(/hidden/i);

    const vectorState = createParameterState([{
      documentId: "doc-vector",
      revision: 0,
      source: "pose = [0, 1, 2, 3, 4, 5]; cube(1);",
    }]);
    expect(() => reduceParameterState(vectorState, {
      kind: "set-value",
      documentId: "doc-vector",
      name: "pose",
      value: [6, 7, 8, 9, 10],
    })).toThrow(/compatible/i);
    expect(() => reduceParameterState(vectorState, {
      kind: "set-value",
      documentId: "doc-vector",
      name: "pose",
      value: [6, 7, 8, 9, 10, Number.NEGATIVE_INFINITY],
    })).toThrow(/compatible/i);
  });
});
