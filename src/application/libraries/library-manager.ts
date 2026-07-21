import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

import type { ProjectStorage } from "../files/project-file-service";
import { parseProjectPath } from "../files/project-path";
import type { ProjectFileContent } from "../files/project-snapshot";

export const LIBRARY_MANIFEST_PATH = "scadmill.libraries.json";
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 20_000;
const MAX_LICENSE_BYTES = 1024 * 1024;

export interface LibraryLicense {
  readonly spdxId: string;
  readonly url: string;
}

export interface OpenScadLibraryDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly archiveUrl: string;
  readonly sourceUrl: string;
  readonly vendorDirectory: string;
  readonly license: LibraryLicense;
  readonly github?: {
    readonly owner: string;
    readonly repository: string;
    readonly ref: string;
  };
}

export interface CustomOpenScadLibraryInput {
  readonly displayName: string;
  readonly version: string;
  readonly archiveUrl: string;
  readonly sourceUrl: string;
  readonly vendorDirectory: string;
  readonly licenseSpdxId: string;
  readonly licenseUrl: string;
}

export const WELL_KNOWN_OPENSCAD_LIBRARIES: readonly OpenScadLibraryDescriptor[] = [
  {
    id: "bosl2",
    displayName: "BOSL2",
    version: "v2.0.747",
    archiveUrl: "https://github.com/BelfrySCAD/BOSL2/archive/refs/tags/v2.0.747.zip",
    sourceUrl: "https://github.com/BelfrySCAD/BOSL2",
    vendorDirectory: "BOSL2",
    license: {
      spdxId: "BSD-2-Clause",
      url: "https://github.com/BelfrySCAD/BOSL2/blob/v2.0.747/LICENSE",
    },
    github: { owner: "BelfrySCAD", repository: "BOSL2", ref: "v2.0.747" },
  },
  {
    id: "mcad",
    displayName: "MCAD",
    version: "openscad-2019.05",
    archiveUrl: "https://github.com/openscad/MCAD/archive/refs/tags/openscad-2019.05.zip",
    sourceUrl: "https://github.com/openscad/MCAD",
    vendorDirectory: "MCAD",
    license: {
      spdxId: "LGPL-2.1-only",
      url: "https://github.com/openscad/MCAD/blob/openscad-2019.05/lgpl-2.1.txt",
    },
    github: { owner: "openscad", repository: "MCAD", ref: "openscad-2019.05" },
  },
  {
    id: "dotscad",
    displayName: "dotSCAD",
    version: "v3.3",
    archiveUrl: "https://github.com/JustinSDK/dotSCAD/archive/refs/tags/v3.3.zip",
    sourceUrl: "https://github.com/JustinSDK/dotSCAD",
    vendorDirectory: "dotSCAD",
    license: {
      spdxId: "LGPL-3.0-only",
      url: "https://github.com/JustinSDK/dotSCAD/blob/v3.3/LICENSE",
    },
    github: { owner: "JustinSDK", repository: "dotSCAD", ref: "v3.3" },
  },
] as const;

export function createCustomOpenScadLibraryDescriptor(
  input: CustomOpenScadLibraryInput,
): OpenScadLibraryDescriptor {
  const id = input.displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return validateDescriptor({
    id,
    displayName: input.displayName,
    version: input.version,
    archiveUrl: input.archiveUrl,
    sourceUrl: input.sourceUrl,
    vendorDirectory: input.vendorDirectory,
    license: { spdxId: input.licenseSpdxId, url: input.licenseUrl },
  });
}

export interface InstalledOpenScadLibrary extends OpenScadLibraryDescriptor {
  readonly installedAt: string;
  readonly files: readonly string[];
  readonly licensePath: string;
}

interface LibraryManifest {
  readonly schemaVersion: 1;
  readonly libraries: readonly InstalledOpenScadLibrary[];
}

export interface PreparedOpenScadLibrary {
  readonly descriptor: OpenScadLibraryDescriptor;
  readonly files: ReadonlyMap<string, ProjectFileContent>;
  readonly licensePath: string;
  readonly licenseText: string;
}

export type LibraryArchiveDownload = (
  url: string,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export interface OpenScadLibraryManagerOptions {
  readonly projectId: string;
  readonly storage: ProjectStorage;
  readonly download?: LibraryArchiveDownload;
  readonly now?: () => Date;
}

export interface LibraryInstallOptions {
  readonly repin?: boolean;
}

export interface OpenScadLibraryManager {
  installed(): Promise<readonly InstalledOpenScadLibrary[]>;
  prepare(
    descriptor: OpenScadLibraryDescriptor,
    signal?: AbortSignal,
  ): Promise<PreparedOpenScadLibrary>;
  install(
    prepared: PreparedOpenScadLibrary,
    options?: LibraryInstallOptions,
  ): Promise<InstalledOpenScadLibrary>;
  remove(id: string): Promise<void>;
}

function copyContent(content: ProjectFileContent): ProjectFileContent {
  return typeof content === "string" ? content : content.slice();
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function validateDescriptor(
  descriptor: OpenScadLibraryDescriptor,
): OpenScadLibraryDescriptor {
  const id = requireText(descriptor.id, "Library id");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error("Library id must be a portable lowercase identifier.");
  }
  const vendorDirectory = parseProjectPath(
    requireText(descriptor.vendorDirectory, "Library vendor directory"),
  );
  if (vendorDirectory.includes("/")) {
    throw new Error("Library vendor directory must be one project-root folder.");
  }
  for (const [label, rawUrl] of [
    ["Library archive URL", descriptor.archiveUrl],
    ["Library source URL", descriptor.sourceUrl],
    ["Library license URL", descriptor.license.url],
  ] as const) {
    const url = new URL(requireText(rawUrl, label));
    if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
  }
  const github = descriptor.github;
  if (github) {
    for (const [label, value] of [
      ["GitHub owner", github.owner],
      ["GitHub repository", github.repository],
    ] as const) {
      if (!/^[A-Za-z0-9_.-]+$/.test(requireText(value, label))) {
        throw new Error(`${label} is invalid.`);
      }
    }
    if (!/^[A-Za-z0-9_./-]+$/.test(requireText(github.ref, "GitHub ref"))) {
      throw new Error("GitHub ref is invalid.");
    }
  }
  return {
    id,
    displayName: requireText(descriptor.displayName, "Library display name"),
    version: requireText(descriptor.version, "Library version"),
    archiveUrl: descriptor.archiveUrl,
    sourceUrl: descriptor.sourceUrl,
    vendorDirectory,
    license: {
      spdxId: requireText(descriptor.license.spdxId, "Library license identifier"),
      url: descriptor.license.url,
    },
    ...(github ? { github: { ...github } } : {}),
  };
}

function safeArchiveName(name: string): readonly string[] {
  if (
    !name
    || name.startsWith("/")
    || name.startsWith("\\")
    || name.includes("\\")
    || name.includes("\0")
  ) throw new Error("Library archive contains an unsafe path.");
  const parts = name.split("/").filter((part, index, all) => (
    part.length > 0 || index < all.length - 1
  ));
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error("Library archive path may not escape or contain dot segments.");
  }
  return parts;
}

function isLicenseName(name: string): boolean {
  return /^(?:licen[cs]e|copying|(?:a?gpl|lgpl|bsd|mit)(?:[-_.]?[a-z0-9]+)*)(?:\.[a-z0-9_-]+)?$/i.test(name);
}

function shouldVendor(path: string): boolean {
  const components = path.toLowerCase().split("/");
  const excludedDirectories = new Set([
    ".github", "doc", "docs", "example", "examples", "featured_img", "images",
    "script", "scripts", "test", "tests", "tutorial", "tutorials",
  ]);
  if (components.slice(0, -1).some((component) => excludedDirectories.has(component))) {
    return false;
  }
  const name = path.split("/").at(-1) ?? path;
  if (isLicenseName(name) || /^(?:notice|readme|changelog)(?:\.[a-z0-9_-]+)?$/i.test(name)) {
    return true;
  }
  const extension = name.includes(".") ? name.split(".").at(-1)?.toLowerCase() : "";
  return new Set([
    "3mf", "amf", "csv", "dat", "dxf", "json", "off", "otf", "png", "scad",
    "stl", "svg", "ttf", "txt", "woff", "woff2",
  ]).has(extension ?? "");
}

function textFile(path: string): boolean {
  const name = path.split("/").at(-1) ?? path;
  if (isLicenseName(name)) return true;
  return /\.(?:csv|json|md|scad|svg|txt)$/i.test(name)
    || /^(?:notice|readme|changelog)(?:\.[a-z0-9_-]+)?$/i.test(name);
}

function decodePackageText(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Library text file ${path} is not valid UTF-8.`);
  }
}

interface RelativePackageFile {
  readonly path: string;
  readonly content: Uint8Array;
}

function prepareRelativeFiles(
  descriptor: OpenScadLibraryDescriptor,
  entries: readonly RelativePackageFile[],
): PreparedOpenScadLibrary {
  const files = new Map<string, ProjectFileContent>();
  let scadFiles = 0;
  for (const entry of entries) {
    if (!shouldVendor(entry.path)) continue;
    const destination = parseProjectPath(`${descriptor.vendorDirectory}/${entry.path}`);
    const content = textFile(entry.path)
      ? decodePackageText(entry.content, entry.path)
      : entry.content.slice();
    files.set(destination, content);
    if (entry.path.toLowerCase().endsWith(".scad")) scadFiles += 1;
  }
  if (scadFiles === 0) throw new Error("Library package contains no OpenSCAD source files.");
  const license = entries
    .filter(({ path }) => shouldVendor(path) && isLicenseName(path.split("/").at(-1) ?? ""))
    .sort((left, right) => left.path.split("/").length - right.path.split("/").length
      || left.path.localeCompare(right.path))[0];
  if (!license || license.content.byteLength > MAX_LICENSE_BYTES) {
    throw new Error(license
      ? "Library license file exceeds the supported display size."
      : "Library package must contain a readable license file.");
  }
  const licensePath = parseProjectPath(`${descriptor.vendorDirectory}/${license.path}`);
  const licenseText = decodePackageText(license.content, license.path);
  if (!licenseText.trim()) throw new Error("Library package must contain a readable license file.");
  return Object.freeze({
    descriptor,
    files: new Map([...files].sort(([left], [right]) => left.localeCompare(right))),
    licensePath,
    licenseText,
  });
}

function prepareArchive(
  descriptorInput: OpenScadLibraryDescriptor,
  archive: Uint8Array,
): PreparedOpenScadLibrary {
  const descriptor = validateDescriptor(descriptorInput);
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Library archive exceeds the supported download size.");
  }
  let declaredBytes = 0;
  let declaredFiles = 0;
  const filter = (file: UnzipFileInfo): boolean => {
    safeArchiveName(file.name);
    if (file.name.endsWith("/")) return false;
    declaredFiles += 1;
    declaredBytes += file.originalSize;
    if (
      declaredFiles > MAX_ARCHIVE_FILES
      || declaredBytes > MAX_EXPANDED_BYTES
      || file.originalSize > MAX_ARCHIVE_FILE_BYTES
    ) throw new Error("Library archive expands beyond the supported package limits.");
    return true;
  };
  const unpacked = unzipSync(archive, { filter });
  const entries = Object.entries(unpacked).map(([path, content]) => ({
    content,
    parts: safeArchiveName(path),
  }));
  if (entries.length === 0) throw new Error("Library archive contains no files.");
  const commonRoot = entries.every(({ parts }) => parts[0] === entries[0]?.parts[0])
    && entries.every(({ parts }) => parts.length > 1)
    ? entries[0]?.parts[0]
    : undefined;
  const relativeFiles: RelativePackageFile[] = [];
  for (const entry of entries) {
    const parts = commonRoot ? entry.parts.slice(1) : entry.parts;
    const relative = parts.join("/");
    relativeFiles.push({ path: parseProjectPath(relative), content: entry.content });
  }
  return prepareRelativeFiles(descriptor, relativeFiles);
}

function validateInstalled(value: unknown): InstalledOpenScadLibrary {
  if (typeof value !== "object" || value === null) {
    throw new Error("Library manifest contains an invalid entry.");
  }
  const record = value as Partial<InstalledOpenScadLibrary>;
  const descriptor = validateDescriptor(record as OpenScadLibraryDescriptor);
  if (!Array.isArray(record.files) || record.files.length === 0) {
    throw new Error("Library manifest entry has no owned files.");
  }
  const files = record.files.map((path) => parseProjectPath(requireText(path, "Library file path")));
  if (new Set(files).size !== files.length) {
    throw new Error("Library manifest entry contains duplicate files.");
  }
  const licensePath = parseProjectPath(requireText(record.licensePath, "Library license path"));
  if (!files.includes(licensePath)) {
    throw new Error("Library manifest license is not owned by its library.");
  }
  const installedAt = requireText(record.installedAt, "Library install time");
  if (!Number.isFinite(Date.parse(installedAt))) {
    throw new Error("Library manifest install time is invalid.");
  }
  return { ...descriptor, installedAt, files, licensePath };
}

function decodeManifest(content: ProjectFileContent | undefined): LibraryManifest {
  if (content === undefined) return { schemaVersion: 1, libraries: [] };
  if (typeof content !== "string") throw new Error("Library manifest must be UTF-8 JSON text.");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Library manifest is not valid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Library manifest has an invalid shape.");
  }
  const manifest = value as { schemaVersion?: unknown; libraries?: unknown };
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.libraries)) {
    throw new Error("Library manifest uses an unsupported schema.");
  }
  const libraries = manifest.libraries.map(validateInstalled);
  if (new Set(libraries.map(({ id }) => id)).size !== libraries.length) {
    throw new Error("Library manifest contains duplicate library ids.");
  }
  return { schemaVersion: 1, libraries };
}

function encodeManifest(libraries: readonly InstalledOpenScadLibrary[]): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    libraries: [...libraries].sort((left, right) => left.id.localeCompare(right.id)),
  }, null, 2)}\n`;
}

async function readProjectFile(
  storage: ProjectStorage,
  projectId: string,
  path: string,
): Promise<ProjectFileContent | undefined> {
  if (storage.read) return storage.read(projectId, path);
  return (await storage.snapshot(projectId)).files.get(path as never);
}

async function projectManifest(
  storage: ProjectStorage,
  projectId: string,
): Promise<LibraryManifest> {
  return decodeManifest(await readProjectFile(storage, projectId, LIBRARY_MANIFEST_PATH));
}

async function restoreTouchedFiles(
  storage: ProjectStorage,
  projectId: string,
  original: ReadonlyMap<string, ProjectFileContent>,
  touched: readonly string[],
): Promise<void> {
  const restored = new Set<string>();
  for (const path of [...touched].reverse()) {
    if (restored.has(path)) continue;
    restored.add(path);
    try {
      const content = original.get(path);
      if (content === undefined) await storage.trash(projectId, path);
      else await storage.write(projectId, path, copyContent(content));
    } catch {
      // Preserve the original failure. The next refresh exposes any rollback damage.
    }
  }
}

async function responseBytes(
  response: Response,
  maximum: number,
  sizeError: string,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximum) throw new Error(sizeError);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new Error(sizeError);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw new Error(sizeError);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

interface GitHubTreeItem {
  readonly path: string;
  readonly type: "blob";
  readonly size: number;
}

function githubTreeItem(value: unknown): GitHubTreeItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const item = value as { path?: unknown; type?: unknown; size?: unknown };
  if (
    item.type !== "blob"
    || typeof item.path !== "string"
    || !Number.isSafeInteger(item.size)
    || (item.size as number) < 0
  ) return undefined;
  return { path: safeArchiveName(item.path).join("/"), type: "blob", size: item.size as number };
}

function githubUrlComponent(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, "/");
}

async function prepareGitHubLibrary(
  descriptorInput: OpenScadLibraryDescriptor,
  signal?: AbortSignal,
): Promise<PreparedOpenScadLibrary> {
  const descriptor = validateDescriptor(descriptorInput);
  const github = descriptor.github;
  if (!github) throw new Error("Library has no pinned GitHub package source.");
  const treeUrl = `https://api.github.com/repos/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repository)}/git/trees/${githubUrlComponent(github.ref)}?recursive=1`;
  const treeResponse = await fetch(treeUrl, { signal });
  if (!treeResponse.ok) {
    throw new Error(`Library file inventory failed with HTTP ${treeResponse.status}.`);
  }
  const treeBytes = await responseBytes(
    treeResponse,
    16 * 1024 * 1024,
    "Library file inventory exceeds the supported size.",
  );
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(treeBytes));
  } catch {
    throw new Error("Library file inventory is not valid JSON.");
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("Library file inventory has an invalid shape.");
  }
  const inventory = value as { tree?: unknown; truncated?: unknown };
  if (inventory.truncated === true) throw new Error("Library file inventory was truncated.");
  if (!Array.isArray(inventory.tree)) throw new Error("Library file inventory has no file list.");
  const selected = inventory.tree
    .map(githubTreeItem)
    .filter((item): item is GitHubTreeItem => Boolean(item && shouldVendor(item.path)));
  if (selected.length === 0 || selected.length > MAX_ARCHIVE_FILES) {
    throw new Error("Library package has an unsupported file count.");
  }
  const expandedBytes = selected.reduce((sum, item) => sum + item.size, 0);
  if (
    expandedBytes > MAX_EXPANDED_BYTES
    || selected.some(({ size }) => size > MAX_ARCHIVE_FILE_BYTES)
  ) throw new Error("Library package expands beyond the supported package limits.");

  const results = new Array<RelativePackageFile>(selected.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const item = selected[index];
      if (!item) return;
      const rawPath = item.path.split("/").map(encodeURIComponent).join("/");
      const url = `https://raw.githubusercontent.com/${encodeURIComponent(github.owner)}/${encodeURIComponent(github.repository)}/${githubUrlComponent(github.ref)}/${rawPath}`;
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`Library file ${item.path} failed with HTTP ${response.status}.`);
      }
      const content = await responseBytes(
        response,
        MAX_ARCHIVE_FILE_BYTES,
        `Library file ${item.path} exceeds the supported size.`,
      );
      if (content.byteLength !== item.size) {
        throw new Error(`Library file ${item.path} did not match its pinned inventory size.`);
      }
      results[index] = { path: item.path, content };
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, selected.length) }, worker));
  return prepareRelativeFiles(descriptor, results);
}

export async function downloadLibraryArchive(
  url: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("Library archive URL must use HTTPS.");
  const response = await fetch(target, { signal });
  if (!response.ok) throw new Error(`Library download failed with HTTP ${response.status}.`);
  return responseBytes(
    response,
    MAX_ARCHIVE_BYTES,
    "Library archive exceeds the supported download size.",
  );
}

export function createOpenScadLibraryManager(
  options: OpenScadLibraryManagerOptions,
): OpenScadLibraryManager {
  const projectId = requireText(options.projectId, "Project id");
  const now = options.now ?? (() => new Date());
  const snapshotFiles = async () => new Map<string, ProjectFileContent>(
    (await options.storage.snapshot(projectId)).files,
  );

  return {
    installed: async () => (await projectManifest(options.storage, projectId)).libraries,
    prepare: async (descriptor, signal) => {
      const validated = validateDescriptor(descriptor);
      if (!options.download && validated.github) {
        return prepareGitHubLibrary(validated, signal);
      }
      const download = options.download ?? downloadLibraryArchive;
      return prepareArchive(validated, await download(validated.archiveUrl, signal));
    },
    install: async (prepared, installOptions = {}) => {
      const descriptor = validateDescriptor(prepared.descriptor);
      const manifest = await projectManifest(options.storage, projectId);
      const existing = manifest.libraries.find(({ id }) => id === descriptor.id);
      if (existing && !installOptions.repin) {
        throw new Error(
          existing.version === descriptor.version
            ? `${descriptor.displayName} ${descriptor.version} is already installed.`
            : `${descriptor.displayName} is pinned to ${existing.version}; update requires an explicit re-pin.`,
        );
      }
      const original = await snapshotFiles();
      const previouslyOwned = new Set(existing?.files ?? []);
      for (const path of prepared.files.keys()) {
        const owner = manifest.libraries.find(({ files }) => files.includes(path));
        if ((original.has(path) && !previouslyOwned.has(path)) || (owner && owner.id !== descriptor.id)) {
          throw new Error(`Library destination ${path} collides with an unowned project file.`);
        }
      }
      const installed: InstalledOpenScadLibrary = {
        ...descriptor,
        installedAt: now().toISOString(),
        files: [...prepared.files.keys()],
        licensePath: prepared.licensePath,
      };
      const nextLibraries = [
        ...manifest.libraries.filter(({ id }) => id !== descriptor.id),
        installed,
      ];
      const staleFiles = (existing?.files ?? []).filter((path) => !prepared.files.has(path));
      const touched: string[] = [];
      try {
        for (const [path, content] of prepared.files) {
          touched.push(path);
          await options.storage.write(projectId, path, copyContent(content));
        }
        for (const path of staleFiles) {
          touched.push(path);
          await options.storage.trash(projectId, path);
        }
        touched.push(LIBRARY_MANIFEST_PATH);
        await options.storage.write(projectId, LIBRARY_MANIFEST_PATH, encodeManifest(nextLibraries));
        return installed;
      } catch (error) {
        await restoreTouchedFiles(options.storage, projectId, original, touched);
        throw error;
      }
    },
    remove: async (idInput) => {
      const id = requireText(idInput, "Library id");
      const manifest = await projectManifest(options.storage, projectId);
      const existing = manifest.libraries.find((library) => library.id === id);
      if (!existing) throw new Error(`Library ${id} is not installed.`);
      const original = await snapshotFiles();
      const touched: string[] = [];
      try {
        for (const path of existing.files) {
          if (!original.has(path)) continue;
          touched.push(path);
          await options.storage.trash(projectId, path);
        }
        touched.push(LIBRARY_MANIFEST_PATH);
        await options.storage.write(
          projectId,
          LIBRARY_MANIFEST_PATH,
          encodeManifest(manifest.libraries.filter((library) => library.id !== id)),
        );
      } catch (error) {
        await restoreTouchedFiles(options.storage, projectId, original, touched);
        throw error;
      }
    },
  };
}
