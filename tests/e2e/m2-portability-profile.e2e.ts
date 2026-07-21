import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const MIB = 1024 * 1024;
const GATE_ARTIFACT_DIR = process.env.SCADMILL_GATE_ARTIFACT_DIR?.trim()
  ? resolve(process.env.SCADMILL_GATE_ARTIFACT_DIR)
  : null;

test.setTimeout(120_000);

test("near-limit project ZIP work stays cancellable, bounded, and off the UI thread", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/tests/e2e/fixtures/m2-portability-profile.html");
  await expect.poll(() => page.evaluate(() => typeof window.scadmillPortabilityProfile)).toBe("function");
  const profile = await page.evaluate(() => window.scadmillPortabilityProfile());
  await testInfo.attach("project-portability-profile.json", {
    body: JSON.stringify(profile, null, 2),
    contentType: "application/json",
  });
  if (GATE_ARTIFACT_DIR) {
    await mkdir(GATE_ARTIFACT_DIR, { recursive: true });
    await writeFile(
      resolve(GATE_ARTIFACT_DIR, "project-portability-profile.json"),
      `${JSON.stringify(profile, null, 2)}\n`,
      "utf8",
    );
  }

  expect(profile.assetBytes).toBe(92 * MIB);
  expect(profile.archiveBytes).toBeGreaterThan(90 * MIB);
  expect(profile.archiveBytes).toBeLessThanOrEqual(100 * MIB);
  expect(profile.cancellationMs).toBeLessThan(250);
  expect(profile.sourceAssetStillAttached).toBe(true);
  expect(profile.decodedAssetMatches).toBe(true);
  expect(profile.longTaskCount).toBe(0);
  expect(profile.longestLongTaskMs).toBe(0);
  expect(profile.maximumHeartbeatGapMs).toBeLessThan(50);
  if (profile.peakHeapDeltaBytes !== null) {
    expect(profile.peakHeapDeltaBytes).toBeLessThan(350 * MIB);
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
