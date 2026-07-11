import type {
  ArtifactDestination,
  ArtifactSaveResult,
} from "./artifact-destination";
import { decodeProjectZip, encodeProjectZip, ProjectZipError } from "./project-zip";
import { decodeShareLink, encodeShareLink, type SharedSource } from "./share-link";
import type { ProjectSnapshot } from "./project-snapshot";
import { messages } from "../../messages/en";

const DEFAULT_ARCHIVE_BYTE_LIMIT = 100 * 1024 * 1024;

export interface ProjectArchiveFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface CurrentPortableProject {
  readonly displayName: string;
  readonly snapshot: ProjectSnapshot;
}

export interface ImportedPortableProject extends CurrentPortableProject {
  readonly entryFile: string;
}

export interface ProjectPortabilityPort {
  readonly artifacts: ArtifactDestination;
  copyText(value: string): Promise<void>;
  currentHref(): string;
  currentProject(): CurrentPortableProject;
  currentSource(): string;
  installImportedProject(project: ImportedPortableProject): Promise<void>;
  makeProjectId(): string;
  openSharedScratch(source: string): Promise<void>;
}

export interface ProjectPortabilityLimits {
  readonly archiveByteLimit?: number;
  readonly decompressedByteLimit?: number;
}

export interface ProjectPortabilityController {
  readonly artifactSavingAvailable: boolean;
  copyShareLink(): Promise<string>;
  exportProjectZip(): Promise<ArtifactSaveResult>;
  importProjectZip(file: ProjectArchiveFile): Promise<{ readonly displayName: string }>;
  openStartupShare(): Promise<SharedSource | null>;
}

export class ShareLinkCopyError extends Error {
  constructor(readonly href: string) {
    super("Clipboard write failed after the share link was generated.");
    this.name = "ShareLinkCopyError";
  }
}

function archiveLimit(value: number | undefined): number {
  const selected = value ?? DEFAULT_ARCHIVE_BYTE_LIMIT;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new ProjectZipError(messages.projectArchiveLimitInvalid);
  }
  return selected;
}

function archiveDisplayName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/u).at(-1)?.trim() ?? "";
  const withoutExtension = leaf.replace(/\.zip$/iu, "").trim();
  return withoutExtension || messages.importedProjectDefaultName;
}

function archiveSuggestedName(displayName: string, projectId: string): string {
  const selected = displayName.trim() || projectId;
  return `${selected.replace(/\.zip$/iu, "")}.zip`;
}

function importedEntryFile(snapshot: ProjectSnapshot): string {
  const textPaths = [...snapshot.files]
    .filter((entry): entry is [typeof entry[0], string] => typeof entry[1] === "string")
    .map(([path]) => path)
    .sort((left, right) => left.localeCompare(right));
  const entry = textPaths.find((path) => path === "main.scad")
    ?? textPaths.find((path) => path.toLowerCase().endsWith(".scad"))
    ?? textPaths[0];
  if (!entry) throw new ProjectZipError(messages.projectZipNoOpenableText);
  return entry;
}

function containsShareFragment(href: string): boolean {
  try {
    return new URL(href).hash.startsWith("#scadmill-share=");
  } catch {
    return false;
  }
}

export function createProjectPortabilityController(
  port: ProjectPortabilityPort,
  limits: ProjectPortabilityLimits = {},
): ProjectPortabilityController {
  const maximumArchiveBytes = archiveLimit(limits.archiveByteLimit);
  let startupShare: Promise<SharedSource | null> | undefined;
  return {
    artifactSavingAvailable: port.artifacts.available,
    copyShareLink: async () => {
      const href = await encodeShareLink(port.currentSource(), port.currentHref());
      try {
        await port.copyText(href);
      } catch {
        throw new ShareLinkCopyError(href);
      }
      return href;
    },
    exportProjectZip: async () => {
      if (!port.artifacts.available) {
        throw new ProjectZipError(messages.artifactSavingUnavailable);
      }
      const project = port.currentProject();
      return port.artifacts.save({
        suggestedName: archiveSuggestedName(project.displayName, project.snapshot.projectId),
        bytes: encodeProjectZip(project.snapshot),
        mimeType: "application/zip",
      });
    },
    importProjectZip: async (file) => {
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new ProjectZipError(messages.projectArchiveSizeInvalid);
      }
      if (file.size > maximumArchiveBytes) {
        throw new ProjectZipError(messages.projectArchiveTooLarge);
      }
      const archive = new Uint8Array(await file.arrayBuffer());
      const snapshot = decodeProjectZip(port.makeProjectId(), archive, {
        archiveByteLimit: maximumArchiveBytes,
        ...(limits.decompressedByteLimit === undefined
          ? {}
          : { decompressedByteLimit: limits.decompressedByteLimit }),
      });
      const displayName = archiveDisplayName(file.name);
      await port.installImportedProject({
        snapshot,
        displayName,
        entryFile: importedEntryFile(snapshot),
      });
      return { displayName };
    },
    openStartupShare: () => {
      startupShare ??= (async () => {
        const href = port.currentHref();
        if (!containsShareFragment(href)) return null;
        const shared = await decodeShareLink(href);
        await port.openSharedScratch(shared.source);
        return shared;
      })();
      return startupShare;
    },
  };
}
