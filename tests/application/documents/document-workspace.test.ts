import { describe, expect, it } from "vitest";

import {
  activeDocument,
  canReopenDocument,
  createDocumentWorkspace,
  isDocumentDirty,
  reduceDocumentWorkspace,
} from "../../../src/application/documents/document-workspace";

const seeds = [
  { id: "document-main", path: "main.scad", source: "cube(10);" },
  { id: "document-wheel", path: "parts/wheel.scad", source: "cylinder(r = 4, h = 2);" },
] as const;

describe("document workspace", () => {
  it("targets edits by stable id and preserves clean sibling buffers", () => {
    const initial = createDocumentWorkspace(seeds, "document-main");
    const edited = reduceDocumentWorkspace(initial, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(20);",
    });

    expect(edited.documents.map(({ id, source }) => ({ id, source }))).toEqual([
      { id: "document-main", source: "cube(20);" },
      { id: "document-wheel", source: "cylinder(r = 4, h = 2);" },
    ]);
    expect(isDocumentDirty(edited.documents[0])).toBe(true);
    expect(isDocumentDirty(edited.documents[1])).toBe(false);
    expect(
      reduceDocumentWorkspace(edited, {
        kind: "edit",
        documentId: "document-main",
        source: "cube(20);",
      }),
    ).toBe(edited);

    const undone = reduceDocumentWorkspace(edited, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(10);",
    });
    expect(undone.documents[0].revision).toBe(2);
    expect(isDocumentDirty(undone.documents[0])).toBe(false);
  });

  it("activates and reorders without changing buffer identity or contents", () => {
    const initial = createDocumentWorkspace(seeds, "document-main");
    const activated = reduceDocumentWorkspace(initial, {
      kind: "activate",
      documentId: "document-wheel",
    });
    const reordered = reduceDocumentWorkspace(activated, {
      kind: "move",
      documentId: "document-main",
      toIndex: 1,
    });

    expect(activated.activeDocumentId).toBe("document-wheel");
    expect(reordered.documents.map(({ id }) => id)).toEqual([
      "document-wheel",
      "document-main",
    ]);
    expect(activeDocument(reordered)).toMatchObject({
      id: "document-wheel",
      source: "cylinder(r = 4, h = 2);",
    });
    expect(reordered.documents.every((document) => !isDocumentDirty(document))).toBe(true);
  });

  it("closes only clean non-final tabs and selects the right neighbor before the left", () => {
    const three = createDocumentWorkspace([
      ...seeds,
      { id: "document-axle", path: "parts/axle.scad", source: "cylinder(r = 1, h = 20);" },
    ], "document-wheel");
    const closedMiddle = reduceDocumentWorkspace(three, {
      kind: "close",
      documentId: "document-wheel",
    });

    expect(closedMiddle.documents.map(({ id }) => id)).toEqual([
      "document-main",
      "document-axle",
    ]);
    expect(closedMiddle.activeDocumentId).toBe("document-axle");
    expect(closedMiddle.recentlyClosed.at(-1)).toMatchObject({
      index: 1,
      document: { id: "document-wheel" },
    });

    const dirty = reduceDocumentWorkspace(closedMiddle, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(11);",
    });
    expect(reduceDocumentWorkspace(dirty, { kind: "close", documentId: "document-main" })).toBe(dirty);

    const one = createDocumentWorkspace([seeds[0]], "document-main");
    expect(reduceDocumentWorkspace(one, { kind: "close", documentId: "document-main" })).toBe(one);
  });

  it("preserves the active document when a different clean tab closes", () => {
    const initial = createDocumentWorkspace(seeds, "document-main");
    const closed = reduceDocumentWorkspace(initial, {
      kind: "close",
      documentId: "document-wheel",
    });

    expect(closed.activeDocumentId).toBe("document-main");
    expect(activeDocument(closed).source).toBe("cube(10);");
  });

  it("reopens the last clean snapshot at its former index and activates it", () => {
    const initial = createDocumentWorkspace(seeds, "document-main");
    const closed = reduceDocumentWorkspace(initial, {
      kind: "close",
      documentId: "document-main",
    });
    const reopened = reduceDocumentWorkspace(closed, { kind: "reopen" });

    expect(reopened.documents).toEqual(initial.documents);
    expect(reopened.activeDocumentId).toBe("document-main");
    expect(reopened.recentlyClosed).toEqual([]);
    expect(reduceDocumentWorkspace(reopened, { kind: "reopen" })).toBe(reopened);
  });

  it("rejects invalid seed identities and runtime identity collisions", () => {
    expect(() => createDocumentWorkspace([
      { id: "", path: "main.scad", source: "cube(1);" },
    ])).toThrow(/non-empty id/u);
    expect(() => createDocumentWorkspace([
      { id: "document-a", path: "", source: "cube(1);" },
    ])).toThrow(/non-empty path/u);
    expect(() => createDocumentWorkspace([
      { id: "duplicate", path: "a.scad", source: "cube(1);" },
      { id: "duplicate", path: "b.scad", source: "cube(2);" },
    ])).toThrow(/unique document ids/u);
    expect(() => createDocumentWorkspace([
      { id: "document-a", path: "same.scad", source: "cube(1);" },
      { id: "document-b", path: "same.scad", source: "cube(2);" },
    ])).toThrow(/unique document paths/u);

    const initial = createDocumentWorkspace(seeds, "document-main");
    expect(reduceDocumentWorkspace(initial, {
      kind: "open",
      document: { id: "document-main", path: "spoof.scad", source: "sphere(9);" },
    })).toBe(initial);
    expect(reduceDocumentWorkspace(initial, {
      kind: "open",
      document: { id: "spoof-id", path: "main.scad", source: "sphere(9);" },
    })).toBe(initial);
  });

  it("rejects invalid move destinations instead of recording a different applied index", () => {
    const initial = createDocumentWorkspace(seeds, "document-main");
    for (const toIndex of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, 2, 999]) {
      expect(reduceDocumentWorkspace(initial, {
        kind: "move",
        documentId: "document-main",
        toIndex,
      })).toBe(initial);
    }
  });

  it("prunes a closed snapshot when that exact document is opened another way", () => {
    const initial = createDocumentWorkspace(seeds, "document-main");
    const closed = reduceDocumentWorkspace(initial, {
      kind: "close",
      documentId: "document-main",
    });
    const opened = reduceDocumentWorkspace(closed, {
      kind: "open",
      document: seeds[0],
    });

    expect(opened.activeDocumentId).toBe("document-main");
    expect(opened.recentlyClosed).toEqual([]);
    expect(canReopenDocument(opened)).toBe(false);
    expect(reduceDocumentWorkspace(opened, { kind: "reopen" })).toBe(opened);
  });

  it("marks only the persisted revision saved and preserves edits made during an async save", () => {
    const initial = createDocumentWorkspace([seeds[0]]);
    const saving = reduceDocumentWorkspace(initial, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(11);",
    });
    const editedAgain = reduceDocumentWorkspace(saving, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(12);",
    });
    const completed = reduceDocumentWorkspace(editedAgain, {
      kind: "mark-saved",
      documentId: "document-main",
      revision: saving.documents[0].revision,
      source: saving.documents[0].source,
    });

    expect(completed.documents[0]).toMatchObject({
      source: "cube(12);",
      savedSource: "cube(11);",
      revision: 2,
      savedRevision: 1,
    });
    expect(isDocumentDirty(completed.documents[0])).toBe(true);
  });

  it("reloads from disk, renames paths, and supports an explicit confirmed close", () => {
    let state = createDocumentWorkspace(seeds, "document-main");
    state = reduceDocumentWorkspace(state, {
      kind: "edit",
      documentId: "document-main",
      source: "cube(11);",
    });
    state = reduceDocumentWorkspace(state, {
      kind: "replace-from-disk",
      documentId: "document-main",
      source: "cube(20);",
    });
    state = reduceDocumentWorkspace(state, {
      kind: "rename-path",
      documentId: "document-main",
      path: "renamed.scad",
    });

    expect(state.documents[0]).toMatchObject({
      path: "renamed.scad",
      source: "cube(20);",
      savedSource: "cube(20);",
    });
    expect(isDocumentDirty(state.documents[0])).toBe(false);
    const closed = reduceDocumentWorkspace(state, {
      kind: "confirm-close",
      documentId: "document-main",
    });
    expect(closed.documents.map(({ id }) => id)).toEqual(["document-wheel"]);
  });
});
