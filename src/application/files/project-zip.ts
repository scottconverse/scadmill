import {
  strToU8,
  unzip,
  unzipSync,
  zip,
  zipSync,
  type AsyncTerminable,
  type Zippable,
} from "fflate";

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
const DETERMINISTIC_ARCHIVE_TIME = new Date(1980, 0, 1);
const COOPERATIVE_COPY_CHUNK_BYTES = 1024 * 1024;

export interface ProjectZipLimits {
  readonly archiveByteLimit?: number;
  readonly decompressedByteLimit?: number;
}

export interface ProjectZipOperationOptions extends ProjectZipLimits {
  readonly signal?: AbortSignal;
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

function archiveEntries(snapshot: ProjectSnapshot, copyBinary = true): Zippable {
  if (snapshot.files.has(MANIFEST_PATH as never)) {
    throw new ProjectZipError(messages.projectZipReservedManifest(MANIFEST_PATH));
  }
  const archive = Object.create(null) as Zippable;
  const textPaths: string[] = [];
  for (const [path, content] of snapshot.files) {
    archive[`${PAYLOAD_PREFIX}${path}`] = typeof content === "string"
      ? strToU8(content)
      : copyBinary
        ? content.slice()
        : content;
    if (typeof content === "string") textPaths.push(path);
  }
  archive[MANIFEST_PATH] = strToU8(JSON.stringify({
    version: 1,
    payloadPrefix: PAYLOAD_PREFIX,
    textPaths,
  }));
  return archive;
}

type ProjectZipWorkerRequest =
  | { readonly kind: "encode"; readonly entries: Record<string, Uint8Array> }
  | {
      readonly kind: "decode";
      readonly archive: Uint8Array;
      readonly decompressedLimit: number;
      readonly expandedTooLargeMessage: string;
    };

type ProjectZipWorkerResponse =
  | { readonly kind: "encoded"; readonly bytes: Uint8Array }
  | { readonly kind: "decoded"; readonly entries: Record<string, Uint8Array> }
  | { readonly kind: "error"; readonly name: string; readonly message: string };

function cancelledError(): Error {
  const error = new Error(messages.projectZipOperationCancelled);
  error.name = "AbortError";
  return error;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancelledError();
}

async function cooperativeCopy(
  source: Uint8Array,
  signal: AbortSignal | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  const copy = new Uint8Array(source.byteLength);
  for (let offset = 0; offset < source.byteLength; offset += COOPERATIVE_COPY_CHUNK_BYTES) {
    throwIfCancelled(signal);
    copy.set(
      source.subarray(offset, Math.min(source.byteLength, offset + COOPERATIVE_COPY_CHUNK_BYTES)),
      offset,
    );
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throwIfCancelled(signal);
  return copy;
}

async function transferableArchiveEntries(
  snapshot: ProjectSnapshot,
  signal: AbortSignal | undefined,
): Promise<{ readonly entries: Record<string, Uint8Array>; readonly transfers: Transferable[] }> {
  const source = archiveEntries(snapshot, false);
  const entries = Object.create(null) as Record<string, Uint8Array>;
  const transfers: Transferable[] = [];
  for (const [path, content] of Object.entries(source)) {
    if (!(content instanceof Uint8Array)) {
      throw new ProjectZipError(messages.projectZipMalformed);
    }
    const copy = await cooperativeCopy(content, signal);
    entries[path] = copy;
    transfers.push(copy.buffer);
  }
  return { entries, transfers };
}

function runProjectZipWorker(
  request: ProjectZipWorkerRequest,
  transfers: readonly Transferable[],
  signal: AbortSignal | undefined,
): Promise<ProjectZipWorkerResponse> {
  return new Promise((resolve, reject) => {
    throwIfCancelled(signal);
    const worker = new Worker(new URL("./project-zip.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      operation();
    };
    const cancel = () => finish(() => reject(cancelledError()));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }: MessageEvent<ProjectZipWorkerResponse>) => finish(() => {
      if (data.kind === "error") {
        const error = new Error(data.message);
        error.name = data.name;
        reject(error);
      } else {
        resolve(data);
      }
    });
    worker.onerror = (event) => finish(() => reject(new Error(event.message)));
    try {
      worker.postMessage(request, [...transfers]);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

function abortable<T>(
  signal: AbortSignal | undefined,
  start: (complete: (error: Error | null, value: T) => void) => AsyncTerminable,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    let settled = false;
    let terminate: AsyncTerminable = () => undefined;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      operation();
    };
    const cancel = () => finish(() => {
      terminate();
      reject(cancelledError());
    });
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      terminate = start((error, value) => finish(() => {
        if (error) reject(error);
        else resolve(value);
      }));
    } catch (error) {
      finish(() => reject(error));
    }
  });
}

export function encodeProjectZip(snapshot: ProjectSnapshot): Uint8Array {
  return zipSync(archiveEntries(snapshot), {
    level: 6,
    mtime: DETERMINISTIC_ARCHIVE_TIME,
  });
}

export async function encodeProjectZipAsync(
  snapshot: ProjectSnapshot,
  options: Pick<ProjectZipOperationOptions, "signal"> = {},
): Promise<Uint8Array> {
  try {
    if (typeof Worker === "function") {
      const prepared = await transferableArchiveEntries(snapshot, options.signal);
      const response = await runProjectZipWorker(
        { kind: "encode", entries: prepared.entries },
        prepared.transfers,
        options.signal,
      );
      if (response.kind !== "encoded") throw new Error(messages.projectZipMalformed);
      return response.bytes;
    }
    return await abortable(options.signal, (complete) => zip(
      archiveEntries(snapshot),
      { level: 6, mtime: DETERMINISTIC_ARCHIVE_TIME },
      (error, bytes) => complete(error, bytes),
    ));
  } catch (error) {
    if (error instanceof ProjectZipError || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }
    throw new ProjectZipError(messages.projectZipMalformed);
  }
}

function snapshotFromEntries(
  projectId: string,
  entries: Record<string, Uint8Array>,
  copyBinary = true,
): ProjectSnapshot {
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
    files.set(
      path,
      textPaths.has(path)
        ? decodeUtf8(bytes, `Project file ${path}`)
        : copyBinary
          ? bytes.slice()
          : bytes,
    );
  }
  if ([...textPaths].some((path) => !files.has(path))) {
    throw new ProjectZipError(messages.projectZipManifestMissingTextFile);
  }
  return createProjectSnapshot(projectId, files);
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
  return snapshotFromEntries(projectId, entries);
}

export async function decodeProjectZipAsync(
  projectId: string,
  archive: Uint8Array,
  options: ProjectZipOperationOptions = {},
): Promise<ProjectSnapshot> {
  if (archive.byteLength > limit(options.archiveByteLimit, DEFAULT_ARCHIVE_LIMIT, "Archive limit")) {
    throw new ProjectZipError(messages.projectArchiveTooLarge);
  }
  const decompressedLimit = limit(
    options.decompressedByteLimit,
    DEFAULT_DECOMPRESSED_LIMIT,
    "Decompressed limit",
  );
  let total = 0;
  let expandedLimitError: ProjectZipError | undefined;
  let entries: Record<string, Uint8Array>;
  try {
    if (typeof Worker === "function") {
      const transferableArchive = await cooperativeCopy(archive, options.signal);
      const response = await runProjectZipWorker({
        kind: "decode",
        archive: transferableArchive,
        decompressedLimit,
        expandedTooLargeMessage: messages.projectZipExpandedTooLarge,
      }, [transferableArchive.buffer], options.signal);
      if (response.kind !== "decoded") throw new Error(messages.projectZipMalformed);
      return snapshotFromEntries(projectId, response.entries, false);
    }
    entries = await abortable(options.signal, (complete) => unzip(archive, {
      filter: ({ originalSize }) => {
        total += originalSize;
        if (total > decompressedLimit) {
          expandedLimitError = new ProjectZipError(messages.projectZipExpandedTooLarge);
          throw expandedLimitError;
        }
        return true;
      },
    }, (error, value) => complete(error, value)));
  } catch (error) {
    if (expandedLimitError) throw expandedLimitError;
    if (error instanceof ProjectZipError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof Error && error.message === messages.projectZipExpandedTooLarge) {
      throw new ProjectZipError(messages.projectZipExpandedTooLarge);
    }
    throw new ProjectZipError(messages.projectZipMalformed);
  }
  return snapshotFromEntries(projectId, entries);
}
