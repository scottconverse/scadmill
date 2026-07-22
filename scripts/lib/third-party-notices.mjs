import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import * as path from "node:path";

const noticeFileName = /^(license|licence|copying|notice|unlicense|copyright)([-_.].*)?$/i;

export function isNoticeFileName(name) {
  return noticeFileName.test(name);
}

export function resolveContainedPath(base, candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("Notice file path must stay inside its declared directory.");
  }
  const pathApi = path.win32.isAbsolute(base) && !path.posix.isAbsolute(base)
    ? path.win32
    : path.posix;
  if (path.isAbsolute(candidate) || path.win32.isAbsolute(candidate)) {
    throw new Error(`Notice file path ${candidate} must stay inside its declared directory.`);
  }
  const basePath = pathApi.resolve(base);
  const resolved = pathApi.resolve(basePath, candidate);
  const relative = pathApi.relative(basePath, resolved);
  if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
    throw new Error(`Notice file path ${candidate} must stay inside its declared directory.`);
  }
  return resolved;
}

export async function readContainedFile(directory, candidate) {
  const base = await realpath(directory);
  const lexicalPath = resolveContainedPath(base, candidate);
  const actualPath = await realpath(lexicalPath);
  resolveContainedPath(base, path.relative(base, actualPath));
  const details = await stat(actualPath);
  if (!details.isFile()) throw new Error(`Notice path ${candidate} is not a regular file.`);
  return readFile(actualPath);
}

export function windowsCargoTreeArguments(manifestPath) {
  return [
    "tree",
    "--locked",
    "--target",
    "x86_64-pc-windows-msvc",
    "--edges",
    "normal,build",
    "--no-dedupe",
    "--prefix",
    "none",
    "--format",
    "{p}",
    "--manifest-path",
    manifestPath,
  ];
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedText(value) {
  return `${value.replace(/\r\n?/g, "\n").trimEnd()}\n`;
}

function packageKey(candidate) {
  return `${candidate.ecosystem}:${candidate.name}@${candidate.version}`;
}

export function resolveActivatedCargoPackageIds(metadata, treeOutput) {
  const idsByKey = new Map();
  for (const candidate of metadata.packages ?? []) {
    const key = `${candidate.name}@${candidate.version}`;
    const ids = idsByKey.get(key) ?? [];
    ids.push(candidate.id);
    idsByKey.set(key, ids);
  }
  const activated = new Set();
  for (const line of treeOutput.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const match = /^(\S+) v(\S+)(?: \(.+\))?$/u.exec(line);
    if (!match) throw new Error(`Unexpected cargo tree package line: ${line}`);
    const key = `${match[1]}@${match[2]}`;
    const ids = idsByKey.get(key) ?? [];
    if (ids.length !== 1) {
      throw new Error(`Cargo tree package ${key} maps to ${ids.length} metadata records.`);
    }
    activated.add(ids[0]);
  }
  return activated;
}

export function renderThirdPartyNotices({ npmPackages, rustPackages, vendoredPackages = [], webView2, nsis, msvc }) {
  const packages = [...npmPackages, ...rustPackages, ...vendoredPackages].sort((left, right) =>
    packageKey(left).localeCompare(packageKey(right)),
  );
  const textGroups = new Map();
  const inventory = [];

  for (const candidate of packages) {
    if (!candidate.licenseTexts?.length) {
      throw new Error(`${candidate.name}@${candidate.version} has no exact license text.`);
    }
    const hashes = [];
    for (const entry of candidate.licenseTexts) {
      const text = normalizedText(entry.text);
      const hash = sha256(text);
      hashes.push(hash);
      const group = textGroups.get(hash) ?? { hash, text, packages: new Set() };
      group.packages.add(packageKey(candidate));
      textGroups.set(hash, group);
    }
    inventory.push([
      packageKey(candidate),
      `  License: ${candidate.license}`,
      `  Authors: ${candidate.authors.length > 0 ? candidate.authors.join("; ") : "See package repository"}`,
      `  Repository: ${candidate.repository ?? "Not supplied in package metadata"}`,
      `  License text SHA-256: ${[...new Set(hashes)].sort().join(", ")}`,
    ].join("\n"));
  }

  const texts = [...textGroups.values()]
    .sort((left, right) => left.hash.localeCompare(right.hash))
    .map((group) => [
      `SHA-256: ${group.hash}`,
      "Applies to:",
      ...[...group.packages].sort().map((value) => `  - ${value}`),
      "",
      group.text.trimEnd(),
    ].join("\n"));

  return [
    "SCADMILL THIRD-PARTY NOTICES",
    "",
    "This file inventories the production npm and Windows x86-64 Cargo dependency graph plus pinned vendored runtime components locked for this ScadMill build. Exact license and notice texts are deduplicated below and bound to their consuming packages by SHA-256.",
    "",
    "OpenSCAD is not bundled in the Windows installer. ScadMill requires the user to obtain and configure the separately distributed pinned OpenSCAD engine.",
    "",
    "MICROSOFT WEBVIEW2 RUNTIME",
    "",
    `${webView2.distribution} is carried inside the offline Windows setup and is separately licensed by Microsoft. Installing or using that component is governed by Microsoft's current terms presented from the official download surface.`,
    `Terms and download: ${webView2.termsUrl}`,
    `Official redistribution guidance: ${webView2.distributionUrl}`,
    "",
    "NSIS INSTALLER STUB",
    "",
    `${nsis.distribution} use only ${nsis.compression} compression. The default LZMA compressor is not used.`,
    `License source: ${nsis.sourceUrl}`,
    "",
    nsis.licenseText.trimEnd(),
    "",
    "MICROSOFT VISUAL C++ RUNTIME SUPPORT",
    "",
    `${msvc.distribution} is included in the ScadMill executable under Microsoft's applicable redistribution terms. The packaged executable is verified not to require external VCRUNTIME140.dll or VCRUNTIME140_1.dll files.`,
    `Official redistribution guidance: ${msvc.termsUrl}`,
    "",
    "PACKAGE INVENTORY",
    "",
    ...inventory.flatMap((value) => [value, ""]),
    "EXACT LICENSE AND NOTICE TEXTS",
    "",
    ...texts.flatMap((value) => [value, ""]),
  ].join("\n").trimEnd().concat("\n");
}
