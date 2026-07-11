import {
  type ProjectPath,
  parseProjectPath,
  validateProjectLayout,
} from "./project-path";

export type ProjectFileContent = string | Uint8Array;

export interface ProjectSnapshot {
  readonly projectId: string;
  readonly files: ReadonlyMap<ProjectPath, ProjectFileContent>;
}

export interface OpenTextBufferOverlay {
  readonly documentId: string;
  readonly path: string;
  readonly source: string;
}

function copyContent(content: ProjectFileContent): ProjectFileContent {
  return typeof content === "string" ? content : content.slice();
}

function nonEmptyIdentity(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
}

export function createProjectSnapshot(
  projectId: string,
  files: ReadonlyMap<string, ProjectFileContent>,
): ProjectSnapshot {
  nonEmptyIdentity(projectId, "Project id");
  const paths = validateProjectLayout(files.keys());
  const sortedPaths = [...paths].sort((left, right) => left.localeCompare(right));
  const copiedFiles = new Map<ProjectPath, ProjectFileContent>();
  for (const path of sortedPaths) {
    const content = files.get(path);
    if (content === undefined) throw new Error(`Project content is missing for ${path}.`);
    copiedFiles.set(path, copyContent(content));
  }
  return Object.freeze({ projectId, files: copiedFiles });
}

export function buildRenderFileMap(
  snapshot: ProjectSnapshot,
  openBuffers: readonly OpenTextBufferOverlay[],
): ReadonlyMap<string, ProjectFileContent> {
  const seenDocumentIds = new Set<string>();
  const seenPaths = new Set<string>();
  const overlays = new Map<ProjectPath, string>();
  for (const buffer of openBuffers) {
    nonEmptyIdentity(buffer.documentId, "Document id");
    if (seenDocumentIds.has(buffer.documentId)) {
      throw new Error(`Duplicate open document id ${buffer.documentId}.`);
    }
    seenDocumentIds.add(buffer.documentId);
    const path = parseProjectPath(buffer.path);
    const key = path.toLowerCase();
    if (seenPaths.has(key)) throw new Error(`Duplicate open document path ${path}.`);
    seenPaths.add(key);
    const existing = snapshot.files.get(path);
    if (existing === undefined) {
      throw new Error(`Open document ${path} is not present in the project snapshot.`);
    }
    if (typeof existing !== "string") {
      throw new Error(`Open document ${path} cannot overlay a binary project file.`);
    }
    overlays.set(path, buffer.source);
  }

  const result = new Map<string, ProjectFileContent>();
  for (const [path, content] of snapshot.files) {
    result.set(path, overlays.get(path) ?? copyContent(content));
  }
  return result;
}
