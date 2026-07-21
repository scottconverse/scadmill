export interface RecentProject {
  readonly projectId: string;
  readonly workspaceIdentity: string;
  readonly displayName: string;
  readonly openedAt: string;
}

export interface RecentProjectsPersistence {
  load(): readonly RecentProject[];
  save(projects: readonly RecentProject[]): void;
}

export const EPHEMERAL_RECENT_PROJECTS_PERSISTENCE: RecentProjectsPersistence = Object.freeze({
  load: () => [],
  save: () => undefined,
});

function validateEntry(entry: RecentProject): void {
  if (entry.projectId.trim().length === 0) throw new Error("Project id must be non-empty.");
  if (entry.workspaceIdentity.trim().length === 0) throw new Error("Workspace identity must be non-empty.");
  if (entry.displayName.trim().length === 0) throw new Error("Display name must be non-empty.");
  if (entry.openedAt.trim().length === 0) throw new Error("Opened-at value must be non-empty.");
}

export function validateRecentProjects(projects: readonly RecentProject[]): readonly RecentProject[] {
  if (!Array.isArray(projects)) throw new Error("Recent projects must be a list.");
  for (const project of projects) validateEntry(project);
  if (new Set(projects.map(({ projectId }) => projectId)).size !== projects.length) {
    throw new Error("Recent project ids must be unique.");
  }
  return projects.map((project) => ({ ...project }));
}

export function recordRecentProject(
  current: readonly RecentProject[],
  opened: RecentProject,
  limit = 10,
): readonly RecentProject[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Recent-project limit must be a positive integer.");
  }
  validateEntry(opened);
  for (const entry of current) validateEntry(entry);
  return [opened, ...current.filter(({ projectId }) => projectId !== opened.projectId)].slice(
    0,
    limit,
  );
}
