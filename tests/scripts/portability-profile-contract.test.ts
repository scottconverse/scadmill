import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

it("measures only ZIP encode/decode long tasks instead of replaying fixture setup", async () => {
  const source = await readFile(join(
    process.cwd(),
    "tests",
    "e2e",
    "fixtures",
    "m2-portability-profile.ts",
  ), "utf8");
  const assetSetup = source.indexOf("const asset = await randomAsset()");
  const observation = source.indexOf('observer.observe({ type: "longtask", buffered: false })');
  const encode = source.indexOf("const encodeStartedAt = performance.now()");

  expect(assetSetup).toBeGreaterThanOrEqual(0);
  expect(observation).toBeGreaterThan(assetSetup);
  expect(encode).toBeGreaterThan(observation);
  expect(source).not.toContain('observer.observe({ type: "longtask", buffered: true })');
});
