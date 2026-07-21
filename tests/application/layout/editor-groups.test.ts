import { describe, expect, it } from "vitest";

import {
  createEditorGroupState,
  focusedEditorDocumentId,
  reconcileEditorGroups,
  reduceEditorGroups,
} from "../../../src/application/layout/editor-groups";

describe("editor groups", () => {
  it("opens a second group on the active document and tracks its orientation", () => {
    const initial = createEditorGroupState(["main", "wheel"], "wheel");
    const split = reduceEditorGroups(initial, { kind: "split", documentId: "wheel" });
    const stacked = reduceEditorGroups(split, { kind: "set-orientation", orientation: "vertical" });

    expect(stacked.groups).toHaveLength(2);
    expect(stacked.groups[1]).toMatchObject({ documentIds: ["wheel"], activeDocumentId: "wheel" });
    expect(stacked.focusedGroupId).toBe("secondary");
    expect(stacked.orientation).toBe("vertical");
  });

  it("moves a tab between groups and makes the focused group the render target", () => {
    let state = reduceEditorGroups(
      createEditorGroupState(["main", "wheel", "case"], "main"),
      { kind: "split", documentId: "wheel" },
    );
    state = reduceEditorGroups(state, {
      kind: "move-document",
      documentId: "case",
      targetGroupId: "secondary",
      targetIndex: 0,
    });
    state = reduceEditorGroups(state, {
      kind: "activate",
      groupId: "secondary",
      documentId: "case",
    });

    expect(state.groups[0].documentIds).toEqual(["main"]);
    expect(state.groups[1].documentIds).toEqual(["case", "wheel"]);
    expect(focusedEditorDocumentId(state)).toBe("case");
  });

  it("reconciles opened and closed documents without leaving stale active tabs", () => {
    let state = reduceEditorGroups(
      createEditorGroupState(["main", "wheel"], "main"),
      { kind: "split", documentId: "wheel" },
    );
    state = reconcileEditorGroups(state, ["main", "new"], "main");

    expect(state.groups[0].documentIds).toEqual(["main"]);
    expect(state.groups[1].documentIds).toEqual(["new"]);
    expect(state.groups[1].activeDocumentId).toBe("new");
  });

  it("merges unique tabs back into one group", () => {
    let state = reduceEditorGroups(
      createEditorGroupState(["main", "wheel"], "main"),
      { kind: "split", documentId: "wheel" },
    );
    state = reduceEditorGroups(state, { kind: "close-split" });

    expect(state.groups).toEqual([expect.objectContaining({
      id: "primary",
      documentIds: ["main", "wheel"],
    })]);
    expect(state.focusedGroupId).toBe("primary");
  });
});
