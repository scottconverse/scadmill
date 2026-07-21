#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, createReadStream, openSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ARTIFACT_DIRECTORY = "test-results/m4-hosted-artifacts";
const PLAYWRIGHT_CONFIG = "tests/e2e/m4-hosted.playwright.config.ts";
const STDOUT_LOG = "stdout.log";
const STDERR_LOG = "stderr.log";
const RESULT_FILE = "runner-result.json";

export function resolveM4HostedArtifactDirectory({
  artifactDirectory,
  environment = process.env,
  workingDirectory = process.cwd(),
} = {}) {
  const configured = artifactDirectory ?? environment.SCADMILL_M4_HOSTED_ARTIFACT_DIR;
  return resolve(workingDirectory, configured?.trim() || DEFAULT_ARTIFACT_DIRECTORY);
}

export function runPlaywright(environment = process.env, workingDirectory = process.cwd(), {
  stderrPath,
  stdoutPath,
}) {
  const arguments_ = ["exec", "playwright", "test", "--config", PLAYWRIGHT_CONFIG];
  const command = environment.npm_execpath
    ? process.execPath
    : process.platform === "win32"
      ? environment.ComSpec ?? "cmd.exe"
      : "pnpm";
  const commandArguments = environment.npm_execpath
    ? [environment.npm_execpath, ...arguments_]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "pnpm.cmd", ...arguments_]
      : arguments_;
  const stdout = openSync(stdoutPath, "a");
  const stderr = openSync(stderrPath, "a");
  try {
    return {
      command,
      commandArguments,
      result: spawnSync(command, commandArguments, {
      cwd: workingDirectory,
      env: environment,
        stdio: ["ignore", stdout, stderr],
        windowsHide: true,
      }),
    };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

async function replay(path, destination) {
  for await (const chunk of createReadStream(path)) destination.write(chunk);
}

export async function runM4HostedEvidence({
  artifactDirectory,
  environment = process.env,
  replayOutput = true,
  runPlaywrightCommand = runPlaywright,
  workingDirectory = process.cwd(),
} = {}) {
  const root = resolveM4HostedArtifactDirectory({
    artifactDirectory,
    environment,
    workingDirectory,
  });
  await mkdir(root, { recursive: true });
  await Promise.all([STDOUT_LOG, STDERR_LOG, RESULT_FILE]
    .map((name) => rm(resolve(root, name), { force: true })));
  const stdoutPath = resolve(root, STDOUT_LOG);
  const stderrPath = resolve(root, STDERR_LOG);
  await Promise.all([
    writeFile(stdoutPath, "", "utf8"),
    writeFile(stderrPath, "", "utf8"),
  ]);

  const startedAt = new Date().toISOString();
  let command = "unavailable";
  let commandArguments = [];
  let signal = null;
  let status = 1;
  try {
    const execution = await runPlaywrightCommand(environment, workingDirectory, {
      stderrPath,
      stdoutPath,
    });
    command = execution.command;
    commandArguments = execution.commandArguments;
    if (execution.result.stdout) await appendFile(stdoutPath, execution.result.stdout, "utf8");
    if (execution.result.stderr) await appendFile(stderrPath, execution.result.stderr, "utf8");
    signal = execution.result.signal ?? null;
    if (execution.result.error) {
      await appendFile(stderrPath, `${execution.result.error.message}\n`, "utf8");
    } else if (execution.result.status === null) {
      await appendFile(stderrPath,
        `Playwright ended without an exit code (${signal ?? "no signal"}).\n`, "utf8");
    } else {
      status = execution.result.status;
    }
  } catch (error) {
    await appendFile(stderrPath,
      `${error instanceof Error ? error.message : String(error)}\n`, "utf8");
  }

  await writeFile(resolve(root, RESULT_FILE), `${JSON.stringify({
    schemaVersion: 1,
    command,
    commandArguments,
    config: PLAYWRIGHT_CONFIG,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    signal,
  }, null, 2)}\n`, "utf8");
  if (replayOutput) {
    await replay(stdoutPath, process.stdout);
    await replay(stderrPath, process.stderr);
  }
  return status;
}

const directInvocation = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directInvocation) process.exitCode = await runM4HostedEvidence();
