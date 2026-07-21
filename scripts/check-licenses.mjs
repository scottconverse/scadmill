#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { findDisallowedPackages } from "./lib/licenses.mjs";

const mode = process.argv[2] ?? "all";
if (!["all", "npm", "rust"].includes(mode)) {
  console.error("Usage: node scripts/check-licenses.mjs [all|npm|rust]");
  process.exit(2);
}

function runPnpm(arguments_) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...arguments_], {
      encoding: "utf8",
    });
  }
  if (process.platform === "win32") {
    return execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm.cmd", ...arguments_], {
      encoding: "utf8",
    });
  }
  return execFileSync("pnpm", arguments_, { encoding: "utf8" });
}

function npmPackages() {
  const report = JSON.parse(runPnpm(["licenses", "list", "--json"]));
  return Object.values(report).flatMap((group) =>
    group.map((candidate) => ({
      name: candidate.name,
      version: candidate.versions.join(","),
      license: candidate.license,
      source: "npm-registry",
    })),
  );
}

function rustPackages() {
  const report = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--locked",
        "--format-version",
        "1",
        "--manifest-path",
        "src/desktop-shell/src-tauri/Cargo.toml",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  return report.packages.map((candidate) => ({
    name: candidate.name,
    version: candidate.version,
    license: candidate.license,
    source: candidate.source,
  }));
}

function audit(label, packages) {
  const failures = findDisallowedPackages(packages).sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
  if (failures.length === 0) {
    console.log(`${label} license policy passed: ${packages.length} packages checked.`);
    return true;
  }

  console.error(`${label} license policy failed: ${failures.length} package(s) use an unapproved or unknown license.`);
  for (const candidate of failures) {
    console.error(`- ${candidate.name}@${candidate.version}: ${candidate.license ?? "<missing>"}`);
  }
  return false;
}

let passed = true;
if (mode === "all" || mode === "npm") {
  passed = audit("npm", npmPackages()) && passed;
}
if (mode === "all" || mode === "rust") {
  passed = audit("Rust", rustPackages()) && passed;
}
if (!passed) {
  process.exitCode = 1;
}
