import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  resolveM4HostedArtifactDirectory,
  runM4HostedEvidence,
} from "../../scripts/run-m4-hosted-evidence.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0)
    .map((root) => rm(root, { force: true, recursive: true })));
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "scadmill-m4-hosted-wrapper-"));
  temporaryRoots.push(root);
  return root;
}

function execution(status, stdout = "", stderr = "") {
  return {
    command: "node",
    commandArguments: ["playwright", "test", "--config", "tests/e2e/m4-hosted.playwright.config.ts"],
    result: { error: undefined, signal: null, status, stdout, stderr },
  };
}

it("retains fresh stdout, stderr, and exact successful command metadata", async () => {
  const root = await fixtureRoot();
  await Promise.all([
    writeFile(join(root, "stdout.log"), "stale stdout", "utf8"),
    writeFile(join(root, "stderr.log"), "stale stderr", "utf8"),
    writeFile(join(root, "runner-result.json"), "stale result", "utf8"),
  ]);

  const status = await runM4HostedEvidence({
    artifactDirectory: root,
    runPlaywrightCommand: () => execution(0, "hosted pass\n", "diagnostic\n"),
  });

  expect(status).toBe(0);
  expect(await readFile(join(root, "stdout.log"), "utf8")).toBe("hosted pass\n");
  expect(await readFile(join(root, "stderr.log"), "utf8")).toBe("diagnostic\n");
  expect(JSON.parse(await readFile(join(root, "runner-result.json"), "utf8")))
    .toMatchObject({
      schemaVersion: 1,
      command: "node",
      commandArguments: [
        "playwright",
        "test",
        "--config",
        "tests/e2e/m4-hosted.playwright.config.ts",
      ],
      config: "tests/e2e/m4-hosted.playwright.config.ts",
      status: 0,
      signal: null,
    });
});

it("preserves a Playwright configuration failure and its exact exit status", async () => {
  const root = await fixtureRoot();
  const status = await runM4HostedEvidence({
    artifactDirectory: root,
    runPlaywrightCommand: () => execution(
      2,
      "starting hosted evidence\n",
      "configuration could not load\n",
    ),
  });

  expect(status).toBe(2);
  expect(await readFile(join(root, "stdout.log"), "utf8"))
    .toBe("starting hosted evidence\n");
  expect(await readFile(join(root, "stderr.log"), "utf8"))
    .toBe("configuration could not load\n");
  expect(JSON.parse(await readFile(join(root, "runner-result.json"), "utf8")))
    .toMatchObject({ status: 2 });
});

it("retains output larger than the synchronous child-process buffer directly to log paths", async () => {
  const root = await fixtureRoot();
  const largeOutput = "x".repeat(2 * 1024 * 1024);
  const status = await runM4HostedEvidence({
    artifactDirectory: root,
    replayOutput: false,
    async runPlaywrightCommand(_environment, _workingDirectory, paths) {
      await writeFile(paths.stdoutPath, largeOutput, "utf8");
      await writeFile(paths.stderrPath, "direct stderr\n", "utf8");
      return execution(0);
    },
  });

  expect(status).toBe(0);
  expect((await readFile(join(root, "stdout.log"), "utf8"))).toHaveLength(largeOutput.length);
  expect(await readFile(join(root, "stderr.log"), "utf8")).toBe("direct stderr\n");
});

it("records spawn exceptions and null exit statuses as retained failures", async () => {
  const thrownRoot = await fixtureRoot();
  await expect(runM4HostedEvidence({
    artifactDirectory: thrownRoot,
    runPlaywrightCommand: () => { throw new Error("simulated spawn failure"); },
  })).resolves.toBe(1);
  expect(await readFile(join(thrownRoot, "stderr.log"), "utf8"))
    .toContain("simulated spawn failure");

  const nullRoot = await fixtureRoot();
  const status = await runM4HostedEvidence({
    artifactDirectory: nullRoot,
    runPlaywrightCommand: () => ({
      ...execution(0),
      result: { error: undefined, signal: "SIGTERM", status: null, stdout: "", stderr: "" },
    }),
  });
  expect(status).toBe(1);
  expect(await readFile(join(nullRoot, "stderr.log"), "utf8"))
    .toContain("without an exit code (SIGTERM)");
});

it("uses the default artifact directory for a whitespace environment value", () => {
  expect(resolveM4HostedArtifactDirectory({
    environment: { SCADMILL_M4_HOSTED_ARTIFACT_DIR: "   " },
    workingDirectory: "C:/workspace",
  }).replaceAll("\\", "/")).toBe("C:/workspace/test-results/m4-hosted-artifacts");
});
