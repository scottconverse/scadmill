export interface DocumentSeed {
  id: string;
  path: string;
  source: string;
}

export interface DocumentBuffer extends DocumentSeed {
  revision: number;
  savedRevision: number;
  savedSource: string;
}

export interface ClosedDocument {
  document: DocumentBuffer;
  index: number;
}

export interface DocumentWorkspaceState {
  documents: readonly DocumentBuffer[];
  activeDocumentId: string;
  recentlyClosed: readonly ClosedDocument[];
}

export type DocumentWorkspaceAction =
  | { kind: "open"; document: DocumentSeed }
  | { kind: "activate"; documentId: string }
  | { kind: "edit"; documentId: string; source: string }
  | { kind: "move"; documentId: string; toIndex: number }
  | { kind: "close"; documentId: string }
  | { kind: "reopen" };

function createBuffer(seed: DocumentSeed): DocumentBuffer {
  return { ...seed, revision: 0, savedRevision: 0, savedSource: seed.source };
}

function validSeedIdentity(seed: DocumentSeed): boolean {
  return seed.id.trim().length > 0 && seed.path.trim().length > 0;
}

function validateSeeds(seeds: readonly DocumentSeed[]): void {
  if (seeds.some(({ id }) => id.trim().length === 0)) {
    throw new Error("Every document requires a non-empty id.");
  }
  if (seeds.some(({ path }) => path.trim().length === 0)) {
    throw new Error("Every document requires a non-empty path.");
  }
  if (new Set(seeds.map(({ id }) => id)).size !== seeds.length) {
    throw new Error("A workspace requires unique document ids.");
  }
  if (new Set(seeds.map(({ path }) => path)).size !== seeds.length) {
    throw new Error("A workspace requires unique document paths.");
  }
}

export function createDocumentWorkspace(
  seeds: readonly DocumentSeed[] = [
    { id: "document-main", path: "main.scad", source: "cube(10);" },
  ],
  requestedActiveId?: string,
): DocumentWorkspaceState {
  if (seeds.length === 0) {
    throw new Error("A document workspace requires at least one document.");
  }
  validateSeeds(seeds);
  const documents = seeds.map(createBuffer);
  const activeDocumentId = documents.some(({ id }) => id === requestedActiveId)
    ? (requestedActiveId as string)
    : documents[0].id;
  return { documents, activeDocumentId, recentlyClosed: [] };
}

export function activeDocument(state: DocumentWorkspaceState): DocumentBuffer {
  const document = state.documents.find(({ id }) => id === state.activeDocumentId);
  if (!document) {
    throw new Error("The active document is not open.");
  }
  return document;
}

export function isDocumentDirty(document: DocumentBuffer): boolean {
  return document.source !== document.savedSource;
}

export function canCloseDocument(state: DocumentWorkspaceState, documentId: string): boolean {
  const document = state.documents.find(({ id }) => id === documentId);
  return Boolean(document && state.documents.length > 1 && !isDocumentDirty(document));
}

function reopenCandidateIndex(state: DocumentWorkspaceState): number {
  for (let index = state.recentlyClosed.length - 1; index >= 0; index -= 1) {
    const candidate = state.recentlyClosed[index].document;
    if (!state.documents.some(({ id, path }) => id === candidate.id || path === candidate.path)) {
      return index;
    }
  }
  return -1;
}

export function canReopenDocument(state: DocumentWorkspaceState): boolean {
  return reopenCandidateIndex(state) >= 0;
}

function openDocument(
  state: DocumentWorkspaceState,
  document: DocumentSeed,
): DocumentWorkspaceState {
  if (!validSeedIdentity(document)) return state;
  const idMatch = state.documents.find(({ id }) => id === document.id);
  const pathMatch = state.documents.find(({ path }) => path === document.path);
  if (idMatch || pathMatch) {
    if (idMatch !== pathMatch) return state;
    const recentlyClosed = state.recentlyClosed.filter(
      ({ document: closed }) => closed.id !== document.id && closed.path !== document.path,
    );
    if (idMatch?.id === state.activeDocumentId && recentlyClosed.length === state.recentlyClosed.length) {
      return state;
    }
    return {
      ...state,
      activeDocumentId: idMatch?.id ?? state.activeDocumentId,
      recentlyClosed,
    };
  }
  return {
    ...state,
    documents: [...state.documents, createBuffer(document)],
    activeDocumentId: document.id,
    recentlyClosed: state.recentlyClosed.filter(
      ({ document: closed }) => closed.id !== document.id && closed.path !== document.path,
    ),
  };
}

function editDocument(
  state: DocumentWorkspaceState,
  documentId: string,
  source: string,
): DocumentWorkspaceState {
  const index = state.documents.findIndex(({ id }) => id === documentId);
  if (index < 0 || state.documents[index].source === source) return state;
  const documents = [...state.documents];
  documents[index] = {
    ...documents[index],
    source,
    revision: documents[index].revision + 1,
  };
  return { ...state, documents };
}

function moveDocument(
  state: DocumentWorkspaceState,
  documentId: string,
  requestedIndex: number,
): DocumentWorkspaceState {
  const fromIndex = state.documents.findIndex(({ id }) => id === documentId);
  if (
    fromIndex < 0
    || !Number.isFinite(requestedIndex)
    || !Number.isInteger(requestedIndex)
    || requestedIndex < 0
    || requestedIndex >= state.documents.length
  ) return state;
  const toIndex = requestedIndex;
  if (fromIndex === toIndex) return state;
  const documents = [...state.documents];
  const [document] = documents.splice(fromIndex, 1);
  documents.splice(toIndex, 0, document);
  return { ...state, documents };
}

function closeDocument(
  state: DocumentWorkspaceState,
  documentId: string,
): DocumentWorkspaceState {
  if (!canCloseDocument(state, documentId)) return state;
  const index = state.documents.findIndex(({ id }) => id === documentId);
  const document = state.documents[index];
  const documents = state.documents.filter(({ id }) => id !== documentId);
  const activeDocumentId = state.activeDocumentId === documentId
    ? (documents[index] ?? documents[index - 1]).id
    : state.activeDocumentId;
  return {
    documents,
    activeDocumentId,
    recentlyClosed: [...state.recentlyClosed, { document, index }],
  };
}

function reopenDocument(state: DocumentWorkspaceState): DocumentWorkspaceState {
  const candidateIndex = reopenCandidateIndex(state);
  if (candidateIndex < 0) return state;
  const closed = state.recentlyClosed[candidateIndex];
  const documents = [...state.documents];
  documents.splice(Math.min(closed.index, documents.length), 0, closed.document);
  return {
    documents,
    activeDocumentId: closed.document.id,
    recentlyClosed: state.recentlyClosed.slice(0, candidateIndex),
  };
}

export function reduceDocumentWorkspace(
  state: DocumentWorkspaceState,
  action: DocumentWorkspaceAction,
): DocumentWorkspaceState {
  switch (action.kind) {
    case "open":
      return openDocument(state, action.document);
    case "activate":
      if (action.documentId === state.activeDocumentId) return state;
      return state.documents.some(({ id }) => id === action.documentId)
        ? { ...state, activeDocumentId: action.documentId }
        : state;
    case "edit":
      return editDocument(state, action.documentId, action.source);
    case "move":
      return moveDocument(state, action.documentId, action.toIndex);
    case "close":
      return closeDocument(state, action.documentId);
    case "reopen":
      return reopenDocument(state);
  }
}
