export interface ScratchAutosaveSnapshot {
  readonly path: string;
  readonly source: string;
}

export interface ScratchAutosavePersistence {
  load(): ScratchAutosaveSnapshot | null;
  save(snapshot: ScratchAutosaveSnapshot): void;
}
