import { parseProjectPath, validateProjectLayout } from "./project-path";
import type { ProjectFileContent, ProjectSnapshot } from "./project-snapshot";

export interface ProjectStorage {
  snapshot(projectId: string): Promise<ProjectSnapshot>;
  read?(projectId: string, path: string): Promise<ProjectFileContent | undefined>;
  write(projectId: string, path: string, content: ProjectFileContent): Promise<void>;
  move(projectId: string, from: string, to: string): Promise<void>;
  trash(projectId: string, path: string): Promise<void>;
  reveal(projectId: string, path: string): Promise<void>;
}

function requireProjectId(projectId: string): string {
  const value = projectId.trim();
  if (!value) throw new Error("Project id must be non-empty.");
  return value;
}

function requireExisting(snapshot: ProjectSnapshot, requestedPath: string): string {
  const path = parseProjectPath(requestedPath);
  if (!snapshot.files.has(path)) throw new Error(`Project file ${path} does not exist.`);
  return path;
}

function validateReplacement(
  snapshot: ProjectSnapshot,
  from: string | undefined,
  destination: string,
): string {
  const path = parseProjectPath(destination);
  validateProjectLayout([
    ...[...snapshot.files.keys()].filter((candidate) => candidate !== from),
    path,
  ]);
  return path;
}

export class ProjectFileService {
  readonly projectId: string;

  constructor(projectId: string, private readonly storage: ProjectStorage) {
    this.projectId = requireProjectId(projectId);
  }

  async snapshot(): Promise<ProjectSnapshot> {
    return this.storage.snapshot(this.projectId);
  }

  async createFile(path: string, content: ProjectFileContent = ""): Promise<void> {
    const snapshot = await this.snapshot();
    const destination = validateReplacement(snapshot, undefined, path);
    await this.storage.write(
      this.projectId,
      destination,
      typeof content === "string" ? content : content.slice(),
    );
  }

  async renameFile(path: string, newName: string): Promise<void> {
    if (newName.length === 0 || newName.includes("/") || newName.includes("\\")) {
      throw new Error("The new file name must be one project-path component.");
    }
    try {
      parseProjectPath(newName);
    } catch {
      throw new Error("The new file name is not a safe project file name.");
    }
    const snapshot = await this.snapshot();
    const from = requireExisting(snapshot, path);
    const separator = from.lastIndexOf("/");
    const destination = validateReplacement(
      snapshot,
      from,
      separator < 0 ? newName : `${from.slice(0, separator)}/${newName}`,
    );
    if (from !== destination) await this.storage.move(this.projectId, from, destination);
  }

  async moveFile(path: string, destinationPath: string): Promise<void> {
    const snapshot = await this.snapshot();
    const from = requireExisting(snapshot, path);
    const destination = validateReplacement(snapshot, from, destinationPath);
    if (from !== destination) await this.storage.move(this.projectId, from, destination);
  }

  async deleteFile(path: string): Promise<void> {
    const snapshot = await this.snapshot();
    await this.storage.trash(this.projectId, requireExisting(snapshot, path));
  }

  async revealFile(path: string): Promise<void> {
    const snapshot = await this.snapshot();
    await this.storage.reveal(this.projectId, requireExisting(snapshot, path));
  }
}
