import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { runViewerPerformanceProfile } from "../../scripts/run-viewer-performance-profile.mjs";

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

it("invalidates stale evidence before delegated Playwright lifecycle failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-wrapper-"));
  temporaryRoots.push(root);
  const artifactPath = join(root, "viewer-performance-profile.json");
  await writeFile(artifactPath, '{"status":"pass","stale":true}\n', "utf8");

  await expect(runViewerPerformanceProfile({
    artifactDirectory: root,
    runPlaywrightCommand() {
      throw new Error("simulated Playwright configuration failure");
    },
  })).rejects.toThrow("simulated Playwright configuration failure");
  await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("removes pnpm's leading separator before forwarding Playwright arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-wrapper-"));
  temporaryRoots.push(root);
  const forwarded = [];

  const status = await runViewerPerformanceProfile({
    additionalArguments: ["--", "--list"],
    artifactDirectory: root,
    runPlaywrightCommand(arguments_) {
      forwarded.push(...arguments_);
      return 0;
    },
  });

  expect(status).toBe(0);
  expect(forwarded).toEqual(["--list"]);
});

it("uses the default artifact directory when the environment value is whitespace", async () => {
  const root = await mkdtemp(join(tmpdir(), "scadmill-viewer-wrapper-"));
  temporaryRoots.push(root);
  const defaultDirectory = join(root, "test-results", "m2-viewer-performance");
  const artifactPath = join(defaultDirectory, "viewer-performance-profile.json");
  await mkdir(defaultDirectory, { recursive: true });
  await writeFile(artifactPath, '{"status":"pass","stale":true}\n', "utf8");

  await expect(runViewerPerformanceProfile({
    environment: { SCADMILL_PERF_ARTIFACT_DIR: "   " },
    runPlaywrightCommand() {
      throw new Error("simulated Playwright configuration failure");
    },
    workingDirectory: root,
  })).rejects.toThrow("simulated Playwright configuration failure");
  await expect(access(artifactPath)).rejects.toMatchObject({ code: "ENOENT" });
});
