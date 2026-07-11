export interface ScratchAutosavePersistence {
  load(): string | null;
  save(source: string): void;
}
