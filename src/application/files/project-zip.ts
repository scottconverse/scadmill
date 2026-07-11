import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";

import { parseProjectPath } from "./project-path";
import {
  createProjectSnapshot,
  type ProjectFileContent,
  type ProjectSnapshot,
} from "./project-snapshot";
import { messages } from "../../messages/en";

const MANIFEST_PATH = ".scadmill-project-v1.json";
const PAYLOAD_PREFIX = ".scadmill-files/";
const DEFAULT_ARCHIVE_LIMIT = 100 * 1024 * 1024;
const DEFAULT_DECOMPRESSED_LIMIT = 512 * 1024 * 1024;

export interface ProjectZipLimits {
  readonly archiveByteLimit?: number;
  readonly decompressedByteLimit?: number;
}

export class ProjectZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectZipError";
  }
}

function limit(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new ProjectZipError(messages.projectZipLimitInvalid(label));
  }
  return selected;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectZipError(messages.projectZipInvalidUtf8(label));
  }
}

interface ParsedManifest {
  readonly textPaths: readonly string[];
  readonly payloadPrefix: string | null;
}

function parseManifest(bytes: Uint8Array): ParsedManifest {
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(bytes, "The project manifest"));
  } catch (error) {
    if (error instanceof ProjectZipError) throw error;
    throw new ProjectZipError(messages.projectManifestMalformed);
  }
  const keys = typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value).sort().join(",")
    : "";
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || (keys !== "textPaths,version" && keys !== "payloadPrefix,textPaths,version")
  ) throw new ProjectZipError(messages.projectManifestInvalidShape);
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1
    || !Array.isArray(record.textPaths)
    || !record.textPaths.every((path): path is string => typeof path === "string")
    || (keys.includes("payloadPrefix") && record.payloadPrefix !== PAYLOAD_PREFIX)
  ) throw new ProjectZipError(messages.projectManifestInvalid);
  const paths = record.textPaths.map(parseProjectPath);
  if (new Set(paths).size !== paths.length) {
    throw new ProjectZipError(messages.projectManifestDuplicateTextPaths);
  }
  return {
    textPaths: paths,
    payloadPrefix: record.payloadPrefix === PAYLOAD_PREFIX ? PAYLOAD_PREFIX : null,
  };
}

export function encodeProjectZip(snapshot: ProjectSnapshot): Uint8Array {
  if (snapshot.files.has(MANIFEST_PATH as never)) {
    throw new ProjectZipError(messages.projectZipReservedManifest(MANIFEST_PATH));
  }
  const archive = Object.create(null) as Zippable;
  const textPaths: string[] = [];
  for (const [path, content] of snapshot.files) {
    archive[`${PAYLOAD_PREFIX}${path}`] = typeof content === "string" ? strToU8(content) : content.slice();
    if (typeof content === "string") textPaths.push(path);
  }
  archive[MANIFEST_PATH] = strToU8(JSON.stringify({
    version: 1,
    payloadPrefix: PAYLOAD_PREFIX,
    textPaths,
  }));
  return zipSync(archive, { level: 6 });
}

export function decodeProjectZip(
  projectId: string,
  archive: Uint8Array,
  limits: ProjectZipLimits = {},
): ProjectSnapshot {
  if (archive.byteLength > limit(limits.archiveByteLimit, DEFAULT_ARCHIVE_LIMIT, "Archive limit")) {
    throw new ProjectZipError(messages.projectArchiveTooLarge);
  }
  const decompressedLimit = limit(
    limits.decompressedByteLimit,
    DEFAULT_DECOMPRESSED_LIMIT,
    "Decompressed limit",
  );
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, {
      filter: ({ originalSize }) => {
        total += originalSize;
        if (total > decompressedLimit) throw new ProjectZipError(messages.projectZipExpandedTooLarge);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ProjectZipError) throw error;
    throw new ProjectZipError(messages.projectZipMalformed);
  }
  const manifest = entries[MANIFEST_PATH];
  if (!manifest) throw new ProjectZipError(messages.projectZipManifestMissing);
  const parsedManifest = parseManifest(manifest);
  const textPaths = new Set(parsedManifest.textPaths);
  const files = new Map<string, ProjectFileContent>();
  for (const [rawPath, bytes] of Object.entries(entries)) {
    if (rawPath === MANIFEST_PATH) continue;
    if (rawPath.endsWith("/")) {
      if (bytes.byteLength !== 0) throw new ProjectZipError(messages.projectZipMalformed);
      const directory = parsedManifest.payloadPrefix === null
        ? rawPath.slice(0, -1)
        : rawPath.startsWith(parsedManifest.payloadPrefix)
          ? rawPath.slice(parsedManifest.payloadPrefix.length, -1)
          : (() => { throw new ProjectZipError(messages.projectZipMalformed); })();
      if (directory) parseProjectPath(directory);
      continue;
    }
    const projectPath = parsedManifest.payloadPrefix === null
      ? rawPath
      : rawPath.startsWith(parsedManifest.payloadPrefix)
        ? rawPath.slice(parsedManifest.payloadPrefix.length)
        : (() => { throw new ProjectZipError(messages.projectZipMalformed); })();
    const path = parseProjectPath(projectPath);
    files.set(path, textPaths.has(path) ? decodeUtf8(bytes, `Project file ${path}`) : bytes.slice());
  }
  if ([...textPaths].some((path) => !files.has(path))) {
    throw new ProjectZipError(messages.projectZipManifestMissingTextFile);
  }
  return createProjectSnapshot(projectId, files);
}
