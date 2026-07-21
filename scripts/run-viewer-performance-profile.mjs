#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PROFILE_FILENAME = "viewer-performance-profile.json";
const PLAYWRIGHT_CONFIG = "tests/performance/viewer-performance.playwright.config.ts";
const DEFAULT_ARTIFACT_DIRECTORY = "test-results/m2-viewer-performance";

export function resolveViewerPerformanceArtifactDirectory({
  artifactDirectory,
  environment = process.env,
  workingDirectory = process.cwd(),
} = {}) {
  const configuredDirectory = artifactDirectory
    ?? environment.SCADMILL_PERF_ARTIFACT_DIR;
  return resolve(
    workingDirectory,
    configuredDirectory?.trim() || DEFAULT_ARTIFACT_DIRECTORY,
  );
}

export async function invalidateViewerPerformanceProfile(options = {}) {
  const resolvedDirectory = resolveViewerPerformanceArtifactDirectory(options);
  await mkdir(resolvedDirectory, { recursive: true });
  const artifactPath = resolve(resolvedDirectory, PROFILE_FILENAME);
  await rm(artifactPath, { force: true });
  return artifactPath;
}

export function runPlaywright(additionalArguments = []) {
  const playwrightArguments = [
    "exec",
    "playwright",
    "test",
    "--config",
    PLAYWRIGHT_CONFIG,
    ...additionalArguments,
  ];
  const command = process.env.npm_execpath
    ? process.execPath
    : process.platform === "win32"
      ? process.env.ComSpec ?? "cmd.exe"
      : "pnpm";
  const commandArguments = process.env.npm_execpath
    ? [process.env.npm_execpath, ...playwrightArguments]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm.cmd", ...playwrightArguments]
      : playwrightArguments;
  const result = spawnSync(command, commandArguments, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status === null) {
    throw new Error(`Viewer performance Playwright process ended without an exit code (${result.signal}).`);
  }
  return result.status;
}

export async function runViewerPerformanceProfile({
  additionalArguments = process.argv.slice(2),
  artifactDirectory,
  environment = process.env,
  runPlaywrightCommand = runPlaywright,
  workingDirectory = process.cwd(),
} = {}) {
  await invalidateViewerPerformanceProfile({
    artifactDirectory,
    environment,
    workingDirectory,
  });
  const forwardedArguments = additionalArguments[0] === "--"
    ? additionalArguments.slice(1)
    : additionalArguments;
  return runPlaywrightCommand(forwardedArguments);
}

const directInvocation = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directInvocation) {
  try {
    process.exitCode = await runViewerPerformanceProfile();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
