export interface WorkspaceLayoutPersistence {
  load(): string | null;
  save(serializedLayout: string): void;
}

export const EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE: WorkspaceLayoutPersistence = Object.freeze({
  load: () => null,
  save: () => undefined,
});
