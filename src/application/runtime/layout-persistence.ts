export interface WorkspaceLayoutPersistence {
  load(workspaceIdentity: string): string | null;
  save(workspaceIdentity: string, serializedLayout: string): void;
}

export const EPHEMERAL_WORKSPACE_LAYOUT_PERSISTENCE: WorkspaceLayoutPersistence = Object.freeze({
  load: (_workspaceIdentity: string) => null,
  save: (_workspaceIdentity: string, _serializedLayout: string) => undefined,
});
