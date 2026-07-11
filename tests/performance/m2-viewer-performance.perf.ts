import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import type { ViewerPerformanceProfile } from "./fixtures/m2-viewer-performance";

const ARTIFACT_DIR = resolve(
  process.env.SCADMILL_PERF_ARTIFACT_DIR?.trim() || "test-results/m2-viewer-performance",
);
const TRIANGLE_COUNT = Number(process.env.SCADMILL_PERF_TRIANGLES?.trim() || "2000000");
const HARDWARE_QUALIFICATION = process.env.SCADMILL_PERF_HARDWARE_QUALIFICATION?.trim()
  || "unqualified-current-host";

test.setTimeout(300_000);

test("profiles production orbit rendering at two million triangles by default", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

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
  await page.evaluate(() => {
    window.scadmillViewerProfile = window.runScadMillViewerProfile();
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 0; step < 150; step += 1) {
    const phase = step / 9;
    await page.mouse.move(
      box.x + box.width / 2 + Math.sin(phase) * 120,
      box.y + box.height / 2 + Math.cos(phase) * 60,
    );
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  const profile = await page.evaluate<ViewerPerformanceProfile>(async () => {
    if (!window.scadmillViewerProfile) throw new Error("The viewer sample did not start.");
    return window.scadmillViewerProfile;
  });
  const evidence = { hardwareQualification: HARDWARE_QUALIFICATION, ...profile };
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(
    resolve(ARTIFACT_DIR, "viewer-performance-profile.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );

  expect(profile.triangleCount).toBe(TRIANGLE_COUNT);
  const degraded = TRIANGLE_COUNT > 500_000;
  expect(profile.degradation).toEqual({ edges: degraded, shadow: degraded });
  expect(profile.renderer).not.toMatch(/SwiftShader|llvmpipe|software/iu);
  expect(profile.averageFps).toBeGreaterThan(0);
  if (TRIANGLE_COUNT === 2_000_000) expect(profile.averageFps).toBeGreaterThanOrEqual(30);
  expect(profile.frames).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
