import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import type { ViewerPerformanceProfile } from "./fixtures/m2-viewer-performance";
import {
  assessViewerPerformance,
  collectViewerPerformanceSourceIdentity,
  invalidateViewerPerformanceArtifact,
  publishViewerPerformanceArtifact,
} from "./viewer-performance-evidence";

const ARTIFACT_DIR = resolve(
  process.env.SCADMILL_PERF_ARTIFACT_DIR?.trim() || "test-results/m2-viewer-performance",
);
const TRIANGLE_COUNT = Number(process.env.SCADMILL_PERF_TRIANGLES?.trim() || "2000000");
const OWNER_BASELINE_QUALIFICATION = "owner-baseline-amd-radeon-780m";
const HARDWARE_QUALIFICATION = process.env.SCADMILL_PERF_HARDWARE_QUALIFICATION?.trim()
  || "unqualified-current-host";

test.setTimeout(300_000);

test("profiles production orbit rendering at two million triangles by default", async ({ page }) => {
  const artifactPath = await invalidateViewerPerformanceArtifact(ARTIFACT_DIR);
  if (HARDWARE_QUALIFICATION === OWNER_BASELINE_QUALIFICATION
    && TRIANGLE_COUNT !== 2_000_000) {
    throw new Error("The owner Radeon 780M baseline requires exactly 2,000,000 triangles.");
  }
  const ownerBaseline = HARDWARE_QUALIFICATION === OWNER_BASELINE_QUALIFICATION;
  const sourceIdentity = ownerBaseline
    ? await collectViewerPerformanceSourceIdentity(process.cwd())
    : undefined;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const onPageError = (error: Error) => pageErrors.push(error.message);
  const onConsole = (message: { text(): string; type(): string }) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  };
  page.on("pageerror", onPageError);
  page.on("console", onConsole);

  await page.goto(`/tests/performance/fixtures/m2-viewer-performance.html?triangles=${TRIANGLE_COUNT}`, {
    waitUntil: "commit",
  });
  await expect.poll(() => page.evaluate(() => typeof window.runScadMillViewerProfile), {
    timeout: 120_000,
  }).toBe("function");
  let previousStage = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const state = await page.evaluate(() => ({
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      stage: window.scadmillViewerProfileStatus(),
    }));
    if (state.stage !== previousStage) {
      previousStage = state.stage;
      process.stdout.write(`viewer-profile stage: ${state.stage}\n`);
    }
    if (state.alert) throw new Error(`Viewer profile failed during ${state.stage}: ${state.alert}`);
    if (state.stage === "ready") break;
    await page.waitForTimeout(2_000);
  }
  expect(previousStage).toBe("ready");
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("The performance canvas has no layout box.");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);
  const startedAt = new Date().toISOString();
  await page.evaluate(() => {
    window.scadmillViewerProfile = window.runScadMillViewerProfile();
  });
  await expect.poll(() => page.evaluate(() => window.scadmillViewerProfileStatus())).toBe("sampling");
  await page.mouse.down();
  try {
    let move = 0;
    const orbitStartedAt = Date.now();
    while (Date.now() - orbitStartedAt < 3_100) {
      const angle = move * 0.19;
      await page.mouse.move(
        centerX + Math.cos(angle) * Math.min(box.width * 0.25, 180),
        centerY + Math.sin(angle) * Math.min(box.height * 0.2, 120),
      );
      move += 1;
    }
  } finally {
    await page.mouse.up();
  }
  const profile = await page.evaluate<ViewerPerformanceProfile>(async () => {
    if (!window.scadmillViewerProfile) throw new Error("The viewer sample did not start.");
    return window.scadmillViewerProfile;
  });
  page.off("pageerror", onPageError);
  page.off("console", onConsole);
  const observedPageErrors = Object.freeze([...pageErrors]);
  const observedConsoleErrors = Object.freeze([...consoleErrors]);
  if (ownerBaseline) expect(profile.renderer).toMatch(/AMD Radeon 780M/iu);
  const acceptance = assessViewerPerformance({
    consoleErrors: observedConsoleErrors,
    expectedTriangleCount: TRIANGLE_COUNT,
    pageErrors: observedPageErrors,
    profile,
    requiredRenderer: ownerBaseline ? /AMD Radeon 780M/iu : undefined,
    requiredRendererDescription: ownerBaseline ? "AMD Radeon 780M" : undefined,
  });
  expect(acceptance).toEqual({ errors: [], pass: true });
  await publishViewerPerformanceArtifact(artifactPath, {
    consoleErrors: observedConsoleErrors,
    expectedTriangleCount: TRIANGLE_COUNT,
    hardwareQualification: HARDWARE_QUALIFICATION,
    pageErrors: observedPageErrors,
    profile,
    sourceIdentity,
    startedAt,
  });
});
