import type {
  ArtifactDestination,
  ArtifactSaveResult,
} from "./artifact-destination";
import {
  decodeProjectZipAsync,
  encodeProjectZipAsync,
  ProjectZipError,
  type ProjectZipOperationOptions,
} from "./project-zip";
import { decodeShareLink, encodeShareLink, type SharedSource } from "./share-link";
import type { ProjectSnapshot } from "./project-snapshot";
import { messages } from "../../messages/en";

const DEFAULT_ARCHIVE_BYTE_LIMIT = 100 * 1024 * 1024;

export interface ProjectArchiveFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  stream?(): ReadableStream<Uint8Array>;
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
  readonly projectImportAvailable?: boolean;
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
  readonly codec?: Partial<ProjectArchiveCodec>;
}

export type ProjectArchivePhase = "reading" | "encoding" | "decoding" | "saving" | "installing";

export interface ProjectArchiveProgress {
  readonly phase: ProjectArchivePhase;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
}

export interface ProjectArchiveOperationOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ProjectArchiveProgress) => void;
}

export interface ProjectArchiveCodec {
  encode(
    snapshot: ProjectSnapshot,
    options?: Pick<ProjectZipOperationOptions, "signal">,
  ): Promise<Uint8Array>;
  decode(
    projectId: string,
    archive: Uint8Array,
    options?: ProjectZipOperationOptions,
  ): Promise<ProjectSnapshot>;
}

export interface ProjectPortabilityController {
  readonly artifactSavingAvailable: boolean;
  readonly projectImportAvailable: boolean;
  copyShareLink(): Promise<string>;
  exportProjectZip(options?: ProjectArchiveOperationOptions): Promise<ArtifactSaveResult>;
  importProjectZip(
    file: ProjectArchiveFile,
    options?: ProjectArchiveOperationOptions,
  ): Promise<{ readonly displayName: string }>;
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

function cancelledError(): Error {
  const error = new Error(messages.projectZipOperationCancelled);
  error.name = "AbortError";
  return error;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelledError();
}

async function streamedArchiveBytes(
  file: ProjectArchiveFile,
  maximumArchiveBytes: number,
  options: ProjectArchiveOperationOptions,
): Promise<Uint8Array> {
  throwIfCancelled(options.signal);
  if (!file.stream) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    throwIfCancelled(options.signal);
    if (bytes.byteLength > maximumArchiveBytes) {
      throw new ProjectZipError(messages.projectArchiveTooLarge);
    }
    options.onProgress?.({
      phase: "reading",
      loadedBytes: bytes.byteLength,
      totalBytes: file.size,
    });
    return bytes;
  }

  const reader = file.stream().getReader();
  let bytes = new Uint8Array(file.size);
  let loaded = 0;
  const cancelRead = () => { void reader.cancel(cancelledError()); };
  options.signal?.addEventListener("abort", cancelRead, { once: true });
  try {
    while (true) {
      const result = await reader.read();
      throwIfCancelled(options.signal);
      if (result.done) break;
      const nextSize = loaded + result.value.byteLength;
      if (nextSize > maximumArchiveBytes) {
        await reader.cancel();
        throw new ProjectZipError(messages.projectArchiveTooLarge);
      }
      if (nextSize > bytes.byteLength) {
        const capacity = Math.min(
          maximumArchiveBytes,
          Math.max(nextSize, Math.max(1, bytes.byteLength) * 2),
        );
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, loaded));
        bytes = grown;
      }
      bytes.set(result.value, loaded);
      loaded = nextSize;
      options.onProgress?.({ phase: "reading", loadedBytes: loaded, totalBytes: file.size });
    }
  } finally {
    options.signal?.removeEventListener("abort", cancelRead);
    reader.releaseLock();
  }
  return loaded === bytes.byteLength ? bytes : bytes.slice(0, loaded);
}

export function createProjectPortabilityController(
  port: ProjectPortabilityPort,
  limits: ProjectPortabilityLimits = {},
): ProjectPortabilityController {
  const maximumArchiveBytes = archiveLimit(limits.archiveByteLimit);
  const codec: ProjectArchiveCodec = {
    encode: limits.codec?.encode ?? encodeProjectZipAsync,
    decode: limits.codec?.decode ?? decodeProjectZipAsync,
  };
  let startupShare: Promise<SharedSource | null> | undefined;
  return {
    artifactSavingAvailable: port.artifacts.available,
    projectImportAvailable: port.projectImportAvailable ?? true,
    copyShareLink: async () => {
      const href = await encodeShareLink(port.currentSource(), port.currentHref());
      try {
        await port.copyText(href);
      } catch {
        throw new ShareLinkCopyError(href);
      }
      return href;
    },
    exportProjectZip: async (options = {}) => {
      if (!port.artifacts.available) {
        throw new ProjectZipError(messages.artifactSavingUnavailable);
      }
      const project = port.currentProject();
      throwIfCancelled(options.signal);
      options.onProgress?.({ phase: "encoding" });
      const bytes = await codec.encode(project.snapshot, { signal: options.signal });
      throwIfCancelled(options.signal);
      if (bytes.byteLength > maximumArchiveBytes) {
        throw new ProjectZipError(messages.projectArchiveTooLarge);
      }
      options.onProgress?.({ phase: "saving" });
      return port.artifacts.save({
        suggestedName: archiveSuggestedName(project.displayName, project.snapshot.projectId),
        bytes,
        mimeType: "application/zip",
      });
    },
    importProjectZip: async (file, options = {}) => {
      if (!Number.isSafeInteger(file.size) || file.size < 0) {
        throw new ProjectZipError(messages.projectArchiveSizeInvalid);
      }
      if (file.size > maximumArchiveBytes) {
        throw new ProjectZipError(messages.projectArchiveTooLarge);
      }
      options.onProgress?.({ phase: "reading", loadedBytes: 0, totalBytes: file.size });
      const archive = await streamedArchiveBytes(file, maximumArchiveBytes, options);
      throwIfCancelled(options.signal);
      options.onProgress?.({ phase: "decoding", loadedBytes: archive.byteLength, totalBytes: file.size });
      const snapshot = await codec.decode(port.makeProjectId(), archive, {
        archiveByteLimit: maximumArchiveBytes,
        signal: options.signal,
        ...(limits.decompressedByteLimit === undefined
          ? {}
          : { decompressedByteLimit: limits.decompressedByteLimit }),
      });
      throwIfCancelled(options.signal);
      const displayName = archiveDisplayName(file.name);
      options.onProgress?.({ phase: "installing" });
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
