import { describe, expect, it } from "vitest";
import {
  createParameterState,
  parameterDocument,
  reduceParameterState,
} from "../../../src/application/parameters/parameter-state";

describe("per-document customizer state", () => {
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
  });
});
