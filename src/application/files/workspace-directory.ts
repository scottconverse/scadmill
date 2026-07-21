export interface ProjectLocation {
  readonly projectId: string;
  readonly displayName: string;
}

export interface ProjectDirectoryPicker {
  chooseDirectory(): Promise<ProjectLocation | null>;
}

export interface WorkspaceDirectory {
  listWorkspaces(): Promise<readonly ProjectLocation[]>;
  createWorkspace(displayName: string): Promise<ProjectLocation>;
}
