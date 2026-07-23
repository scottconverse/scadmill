import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  M5_M6_CAPABILITY_IDS,
  verifyM5M6PackagedWalkthrough,
  verifyM5M6PackagedWalkthroughArtifacts,
// @ts-expect-error The release verifier is executable ESM without a separate declaration bundle.
} from "../../scripts/lib/m5-m6-packaged-walkthrough.mjs";

function fixture() {
  return {
    schemaVersion: 1,
    status: "passed",
    sourceCommit: "a".repeat(40),
    applicationSha256: "B".repeat(64),
    startedAt: "2026-07-22T20:00:00.000Z",
    completedAt: "2026-07-22T20:01:00.000Z",
    capabilities: M5_M6_CAPABILITY_IDS.map((id: string) => ({
      id,
      status: "passed",
      evidence: { kind: "packaged-ui", assertion: `Observed ${id}` },
    })),
    screenshots: Array.from({ length: 4 }, (_, index) => ({
      file: `m5-screen-${index}.png`,
      sha256: String(index).repeat(64),
      bytes: 100 + index,
    })),
  };
}

describe("M5/M6 packaged walkthrough verifier", () => {
  it("accepts exactly one named evidence record for every shipped M5/M6 capability", () => {
    expect(verifyM5M6PackagedWalkthrough(fixture()).capabilities).toHaveLength(34);
  });

  it("fails closed on a missing item, non-pass, empty evidence, or duplicate inventory entry", () => {
    const missing = fixture();
    missing.capabilities.pop();
    expect(() => verifyM5M6PackagedWalkthrough(missing)).toThrow(/inventory/u);

    const failed = fixture();
    failed.capabilities[0] = { ...failed.capabilities[0], status: "failed" };
    expect(() => verifyM5M6PackagedWalkthrough(failed)).toThrow(/did not pass/u);

    const empty = fixture();
    empty.capabilities[1] = { ...empty.capabilities[1], evidence: {} };
    expect(() => verifyM5M6PackagedWalkthrough(empty)).toThrow(/no inspectable evidence/u);

    const duplicate = fixture();
    duplicate.capabilities[2] = duplicate.capabilities[1];
    expect(() => verifyM5M6PackagedWalkthrough(duplicate)).toThrow(/inventory/u);
  });

  it("host-verifies canonical identity and every retained PNG byte", async () => {
    const root = await mkdtemp(join(tmpdir(), "scadmill-m5-m6-verifier-"));
    const value = fixture();
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    value.screenshots = value.screenshots.map((entry, index) => ({
      ...entry,
      file: `m5-screen-${index}.png`,
      sha256: createHash("sha256").update(png).digest("hex").toUpperCase(),
      bytes: png.length,
    }));
    const walkthroughPath = join(root, "walkthrough.json");
    const sourceMetadataPath = join(root, "source-metadata.json");
    await Promise.all([
      writeFile(walkthroughPath, JSON.stringify(value)),
      writeFile(sourceMetadataPath, JSON.stringify({
        sourceCommit: value.sourceCommit,
        applicationSha256: value.applicationSha256,
      })),
      ...value.screenshots.map(({ file }) => writeFile(join(root, file), png)),
    ]);
    await expect(verifyM5M6PackagedWalkthroughArtifacts({
      walkthroughPath,
      screenshotsDirectory: root,
      sourceMetadataPath,
    })).resolves.toMatchObject({ status: "passed", capabilityCount: 34, screenshotCount: 4 });
    await writeFile(join(root, value.screenshots[0].file), Buffer.from("not a png"));
    await expect(verifyM5M6PackagedWalkthroughArtifacts({
      walkthroughPath,
      screenshotsDirectory: root,
      sourceMetadataPath,
    })).rejects.toThrow(/byte count|hash|PNG/u);
  });
});
