export type EditorGroupId = "primary" | "secondary";
export type EditorGroupOrientation = "horizontal" | "vertical";

export interface EditorGroup {
  readonly id: EditorGroupId;
  readonly documentIds: readonly string[];
  readonly activeDocumentId?: string;
}

export interface EditorGroupState {
  readonly groups: readonly EditorGroup[];
  readonly focusedGroupId: EditorGroupId;
  readonly orientation: EditorGroupOrientation;
}

export type EditorGroupAction =
  | { readonly kind: "split"; readonly documentId: string }
  | { readonly kind: "close-split" }
  | { readonly kind: "set-orientation"; readonly orientation: EditorGroupOrientation }
  | { readonly kind: "focus"; readonly groupId: EditorGroupId }
  | { readonly kind: "activate"; readonly groupId: EditorGroupId; readonly documentId: string }
  | {
      readonly kind: "move-document";
      readonly documentId: string;
      readonly targetGroupId: EditorGroupId;
      readonly targetIndex?: number;
    };

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

export function createEditorGroupState(
  documentIds: readonly string[],
  activeDocumentId: string,
): EditorGroupState {
  const ids = unique(documentIds);
  const active = ids.includes(activeDocumentId) ? activeDocumentId : ids[0];
  return {
    groups: [{ id: "primary", documentIds: ids, ...(active ? { activeDocumentId: active } : {}) }],
    focusedGroupId: "primary",
    orientation: "horizontal",
  };
}

function groupById(state: EditorGroupState, id: EditorGroupId): EditorGroup | undefined {
  return state.groups.find((group) => group.id === id);
}

function replaceGroup(state: EditorGroupState, replacement: EditorGroup): EditorGroupState {
  return {
    ...state,
    groups: state.groups.map((group) => group.id === replacement.id ? replacement : group),
  };
}

function activeFor(ids: readonly string[], preferred?: string): string | undefined {
  return preferred && ids.includes(preferred) ? preferred : ids[0];
}

export function focusedEditorDocumentId(state: EditorGroupState): string | undefined {
  return groupById(state, state.focusedGroupId)?.activeDocumentId;
}

export function reduceEditorGroups(
  state: EditorGroupState,
  action: EditorGroupAction,
): EditorGroupState {
  switch (action.kind) {
    case "split": {
      if (state.groups.length === 2) {
        return reduceEditorGroups(state, {
          kind: "activate",
          groupId: "secondary",
          documentId: action.documentId,
        });
      }
      const primary = state.groups[0];
      const remaining = primary.documentIds.length > 1
        ? primary.documentIds.filter((id) => id !== action.documentId)
        : primary.documentIds;
      return {
        ...state,
        groups: [
          { ...primary, documentIds: remaining, activeDocumentId: activeFor(remaining, primary.activeDocumentId) },
          { id: "secondary", documentIds: [action.documentId], activeDocumentId: action.documentId },
        ],
        focusedGroupId: "secondary",
      };
    }
    case "close-split": {
      if (state.groups.length === 1) return state;
      const ids = unique(state.groups.flatMap(({ documentIds }) => documentIds));
      const active = focusedEditorDocumentId(state) ?? ids[0];
      return {
        ...state,
        groups: [{ id: "primary", documentIds: ids, ...(active ? { activeDocumentId: active } : {}) }],
        focusedGroupId: "primary",
      };
    }
    case "set-orientation":
      return state.orientation === action.orientation ? state : { ...state, orientation: action.orientation };
    case "focus":
      return groupById(state, action.groupId) && state.focusedGroupId !== action.groupId
        ? { ...state, focusedGroupId: action.groupId }
        : state;
    case "activate": {
      const group = groupById(state, action.groupId);
      if (!group?.documentIds.includes(action.documentId)) return state;
      return {
        ...replaceGroup(state, { ...group, activeDocumentId: action.documentId }),
        focusedGroupId: action.groupId,
      };
    }
    case "move-document": {
      const target = groupById(state, action.targetGroupId);
      if (!target) return state;
      const groups = state.groups.map((group) => {
        const ids = group.documentIds.filter((id) => id !== action.documentId);
        if (group.id !== action.targetGroupId) {
          const active = activeFor(ids, group.activeDocumentId);
          return { ...group, documentIds: ids, ...(active ? { activeDocumentId: active } : { activeDocumentId: undefined }) };
        }
        const index = Math.max(0, Math.min(action.targetIndex ?? ids.length, ids.length));
        ids.splice(index, 0, action.documentId);
        return { ...group, documentIds: ids, activeDocumentId: action.documentId };
      });
      return { ...state, groups, focusedGroupId: action.targetGroupId };
    }
  }
}

export function reconcileEditorGroups(
  state: EditorGroupState,
  openDocumentIds: readonly string[],
  globalActiveDocumentId: string,
): EditorGroupState {
  const open = unique(openDocumentIds);
  const openSet = new Set(open);
  const retained = new Set<string>();
  let groups = state.groups.map((group) => {
    const ids = group.documentIds.filter((id) => {
      if (!openSet.has(id) || retained.has(id)) return false;
      retained.add(id);
      return true;
    });
    const active = activeFor(ids, group.activeDocumentId);
    return { ...group, documentIds: ids, ...(active ? { activeDocumentId: active } : { activeDocumentId: undefined }) };
  });
  const added = open.filter((id) => !retained.has(id));
  if (added.length > 0) {
    const targetId = groupById({ ...state, groups }, state.focusedGroupId)
      ? state.focusedGroupId
      : "primary";
    groups = groups.map((group) => group.id === targetId
      ? {
          ...group,
          documentIds: [...group.documentIds, ...added],
          activeDocumentId: added.includes(globalActiveDocumentId)
            ? globalActiveDocumentId
            : group.activeDocumentId ?? added[0],
        }
      : group);
  }
  const focusedContainsActive = groups.find(({ id }) => id === state.focusedGroupId)
    ?.documentIds.includes(globalActiveDocumentId);
  const activeGroup = focusedContainsActive
    ? groups.find(({ id }) => id === state.focusedGroupId)
    : groups.find(({ documentIds }) => documentIds.includes(globalActiveDocumentId));
  if (!activeGroup) return { ...state, groups };
  groups = groups.map((group) => group.id === activeGroup.id
    ? { ...group, activeDocumentId: globalActiveDocumentId }
    : group);
  return { ...state, groups, focusedGroupId: activeGroup.id };
}
