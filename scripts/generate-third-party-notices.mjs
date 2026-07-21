#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isAllowedLicenseExpression } from "./lib/licenses.mjs";
import {
  isNoticeFileName,
  readContainedFile,
  renderThirdPartyNotices,
  resolveActivatedCargoPackageIds,
  windowsCargoTreeArguments,
} from "./lib/third-party-notices.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "THIRD-PARTY-NOTICES.txt");
const manifestPath = join(root, "third-party", "distribution-components.json");
const check = process.argv.includes("--check");

function command(executable, args) {
  return execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function pnpm(args) {
  if (process.env.npm_execpath) {
    return command(process.execPath, [process.env.npm_execpath, ...args]);
  }
  if (process.platform === "win32") {
    return command(process.env.ComSpec ?? "cmd.exe", [
      "/d",
      "/s",
      "/c",
      "pnpm.cmd",
      ...args,
    ]);
  }
  return command("pnpm", args);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function key(candidate) {
  return `${candidate.ecosystem}:${candidate.name}@${candidate.version}`;
}

function authorNames(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(authorNames);
  if (typeof value.name === "string") return [value.name];
  return [];
}

function repositoryUrl(value) {
  const repository = typeof value === "string" ? value : value?.url;
  return typeof repository === "string"
    ? repository.replace(/^git\+/, "").replace(/\.git$/, "")
    : null;
}

async function licenseTexts(directory, explicitLicenseFile = null) {
  const names = await readdir(directory);
  const selected = new Set(names.filter(isNoticeFileName));
  if (explicitLicenseFile) selected.add(explicitLicenseFile);
  return Promise.all(
    [...selected].sort().map(async (name) => ({
      name,
      text: (await readContainedFile(directory, name)).toString("utf8"),
    })),
  );
}

async function npmPackages() {
  const report = JSON.parse(pnpm(["licenses", "list", "--prod", "--long", "--json"]));
  const packages = [];
  for (const candidate of Object.values(report).flat()) {
    for (const directory of candidate.paths) {
      const packageJson = JSON.parse((await readContainedFile(directory, "package.json")).toString("utf8"));
      packages.push({
        ecosystem: "npm",
        name: packageJson.name,
        version: packageJson.version,
        license: packageJson.license ?? candidate.license,
        authors: authorNames(packageJson.author ?? candidate.author),
        repository: repositoryUrl(packageJson.repository ?? candidate.repository),
        licenseTexts: await licenseTexts(directory, packageJson.licenseFile ?? null),
      });
    }
  }
  return packages;
}

async function rustPackages() {
  const metadata = JSON.parse(command("cargo", [
    "metadata",
    "--locked",
    "--format-version",
    "1",
    "--filter-platform",
    "x86_64-pc-windows-msvc",
    "--manifest-path",
    "src/desktop-shell/src-tauri/Cargo.toml",
  ]));
  const tree = command(
    "cargo",
    windowsCargoTreeArguments("src/desktop-shell/src-tauri/Cargo.toml"),
  );
  const reachable = resolveActivatedCargoPackageIds(metadata, tree);
  return Promise.all(
    metadata.packages
      .filter((candidate) => reachable.has(candidate.id) && candidate.source !== null)
      .map(async (candidate) => {
        const directory = dirname(candidate.manifest_path);
        return {
          ecosystem: "cargo",
          name: candidate.name,
          version: candidate.version,
          license: candidate.license,
          authors: candidate.authors ?? [],
          repository: candidate.repository ?? null,
          licenseTexts: await licenseTexts(directory, candidate.license_file ?? null),
        };
      }),
  );
}

async function applyOverrides(packages, overrides) {
  const byKey = new Map(packages.map((candidate) => [key(candidate), candidate]));
  for (const override of overrides) {
    let texts;
    if (override.sourcePackage) {
      const source = byKey.get(override.sourcePackage);
      if (!source?.licenseTexts.length) {
        throw new Error(`Notice override source ${override.sourcePackage} has no exact license text.`);
      }
      texts = source.licenseTexts;
    } else {
      texts = await Promise.all(
        override.files.map(async (entry) => {
          const bytes = await readContainedFile(root, entry.path);
          const actual = sha256(bytes);
          if (actual !== entry.sha256) {
            throw new Error(`Notice override ${entry.path} SHA-256 is ${actual}, expected ${entry.sha256}.`);
          }
          return { name: `${entry.path} (${entry.sourceUrl})`, text: bytes.toString("utf8") };
        }),
      );
    }
    for (const packageId of override.packages) {
      const target = byKey.get(packageId);
      if (!target) throw new Error(`Notice override target ${packageId} is not in the Windows graph.`);
      if (target.licenseTexts.length > 0) {
        throw new Error(`Notice override target ${packageId} already carries license text.`);
      }
      target.licenseTexts = texts;
    }
  }
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.version !== 1) throw new Error("Unsupported distribution-component manifest version.");
const [npm, rust] = await Promise.all([npmPackages(), rustPackages()]);
const packages = [...npm, ...rust];
for (const candidate of packages) {
  if (!isAllowedLicenseExpression(candidate.license)) {
    throw new Error(`${key(candidate)} has an unapproved or unknown license: ${candidate.license ?? "<missing>"}.`);
  }
}
await applyOverrides(packages, manifest.overrides);
const nsisLicenseBytes = await readContainedFile(root, manifest.nsis.licenseFile.path);
const nsisLicenseHash = sha256(nsisLicenseBytes);
if (nsisLicenseHash !== manifest.nsis.licenseFile.sha256) {
  throw new Error(`NSIS notice SHA-256 is ${nsisLicenseHash}, expected ${manifest.nsis.licenseFile.sha256}.`);
}
const rendered = renderThirdPartyNotices({
  npmPackages: npm,
  rustPackages: rust,
  webView2: manifest.webView2,
  nsis: {
    distribution: manifest.nsis.distribution,
    compression: manifest.nsis.compression,
    sourceUrl: manifest.nsis.licenseFile.sourceUrl,
    licenseText: nsisLicenseBytes.toString("utf8"),
  },
  msvc: manifest.msvc,
});

if (check) {
  const current = await readFile(outputPath, "utf8").catch(() => null);
  if (current !== rendered) {
    console.error("THIRD-PARTY-NOTICES.txt is missing or stale; run pnpm generate:notices.");
    process.exitCode = 1;
  } else {
    console.log(`Third-party notices are current: ${npm.length} npm and ${rust.length} Cargo packages.`);
  }
} else {
  await writeFile(outputPath, rendered, "utf8");
  console.log(`Generated THIRD-PARTY-NOTICES.txt: ${npm.length} npm and ${rust.length} Cargo packages.`);
}
