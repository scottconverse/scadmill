export interface RenderDiskCachePreferencePersistence {
  load(workspaceIdentity: string): boolean;
  save(workspaceIdentity: string, enabled: boolean): void;
}

export const EPHEMERAL_RENDER_DISK_CACHE_PREFERENCES: RenderDiskCachePreferencePersistence = {
  load: () => false,
  save: () => undefined,
};
