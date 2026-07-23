import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export const M5_M6_CAPABILITY_IDS = Object.freeze([
  "M5-HISTORY-SNAPSHOTS",
  "M5-HISTORY-RESTORE",
  "M5-HISTORY-PERSISTENCE",
  "M5-BATCH-DIALOG",
  "M5-BATCH-ARTIFACTS",
  "M5-LIBRARIES-CATALOG",
  "M5-LIBRARIES-OFFLINE",
  "M5-LIBRARIES-INSTALLED-COMPLETION",
  "M5-LIBRARIES-REMOVE",
  "M5-SEARCH",
  "M5-REPLACE",
  "M5-OUTLINE",
  "M5-REFERENCES",
  "M5-SPLIT",
  "M5-SECTION",
  "M5-BOOKMARKS",
  "M6-PRINTABILITY",
  "M6-SLICER-ABSENT",
  "M6-SLICER-CONFIGURED",
  "M6-ENGINE-MISMATCH",
  "M6-ENGINE-INVENTORY",
  "M6-ENGINE-DOWNLOAD-OFFLINE",
  "M6-ENGINE-PIN",
  "M6-CLI-PARAMS",
  "M6-CLI-RENDER",
  "M6-CLI-EXPORT",
  "M6-CLI-CHECK",
  "M6-CLI-ERROR",
  "M6-COLOR-PREVIEW",
  "M6-PART-TOGGLE",
  "M6-COLOR-3MF",
  "M6-COLOR-ROUNDTRIP",
  "M6-ESTIMATE",
  "M6-UPDATE-REPAIR",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function verifyM5M6PackagedWalkthrough(value) {
  assert.ok(exactKeys(value, [
    "schemaVersion", "status", "sourceCommit", "applicationSha256", "startedAt",
    "completedAt", "capabilities", "screenshots",
  ]), "M5/M6 walkthrough has the wrong top-level shape.");
  assert.equal(value.schemaVersion, 1, "M5/M6 walkthrough schema is unsupported.");
  assert.equal(value.status, "passed", "M5/M6 walkthrough did not pass.");
  assert.match(value.sourceCommit, /^[0-9a-f]{40}$/u, "M5/M6 source commit is invalid.");
  assert.match(value.applicationSha256, /^[0-9A-F]{64}$/u, "M5/M6 application hash is invalid.");
  assert.ok(Number.isFinite(Date.parse(value.startedAt)), "M5/M6 start time is invalid.");
  assert.ok(Number.isFinite(Date.parse(value.completedAt)), "M5/M6 completion time is invalid.");
  assert.ok(Date.parse(value.completedAt) >= Date.parse(value.startedAt), "M5/M6 chronology is invalid.");
  assert.ok(Array.isArray(value.capabilities), "M5/M6 capability evidence is missing.");
  assert.deepEqual(
    value.capabilities.map(({ id }) => id),
    M5_M6_CAPABILITY_IDS,
    "M5/M6 capability inventory is incomplete or out of order.",
  );
  for (const capability of value.capabilities) {
    assert.ok(exactKeys(capability, ["id", "status", "evidence"]), `${capability?.id ?? "unknown"} has the wrong shape.`);
    assert.equal(capability.status, "passed", `${capability.id} did not pass.`);
    assert.ok(capability.evidence !== null && typeof capability.evidence === "object"
      && !Array.isArray(capability.evidence) && Object.keys(capability.evidence).length > 0,
    `${capability.id} has no inspectable evidence.`);
    assert.ok(["packaged-ui", "packaged-cli", "exact-ci"].includes(capability.evidence.kind),
      `${capability.id} does not identify its evidence layer.`);
    assert.equal(typeof capability.evidence.assertion, "string", `${capability.id} has no explicit assertion.`);
    assert.ok(capability.evidence.assertion.length > 0, `${capability.id} has an empty assertion.`);
  }
  assert.ok(Array.isArray(value.screenshots) && value.screenshots.length >= 4,
    "M5/M6 walkthrough retained fewer than four screenshots.");
  for (const screenshot of value.screenshots) {
    assert.ok(exactKeys(screenshot, ["file", "sha256", "bytes"]), "M5/M6 screenshot manifest is invalid.");
    assert.match(screenshot.file, /^m[56]-[a-z0-9-]+\.png$/u, "M5/M6 screenshot name is invalid.");
    assert.match(screenshot.sha256, /^[0-9A-F]{64}$/u, "M5/M6 screenshot hash is invalid.");
    assert.ok(Number.isSafeInteger(screenshot.bytes) && screenshot.bytes > 0, "M5/M6 screenshot is empty.");
  }
  return value;
}

export async function verifyM5M6PackagedWalkthroughFile(path) {
  const bytes = await readFile(path);
  const value = verifyM5M6PackagedWalkthrough(JSON.parse(bytes.toString("utf8")));
  return {
    schemaVersion: 1,
    status: "passed",
    walkthroughSha256: sha256(bytes),
    capabilityCount: value.capabilities.length,
    screenshotCount: value.screenshots.length,
  };
}

export async function verifyM5M6PackagedWalkthroughArtifacts({
  walkthroughPath,
  screenshotsDirectory,
  sourceMetadataPath,
}) {
  const [walkthroughBytes, sourceMetadataBytes] = await Promise.all([
    readFile(walkthroughPath),
    readFile(sourceMetadataPath),
  ]);
  const walkthrough = verifyM5M6PackagedWalkthrough(JSON.parse(walkthroughBytes.toString("utf8")));
  const sourceMetadata = JSON.parse(sourceMetadataBytes.toString("utf8"));
  assert.equal(walkthrough.sourceCommit, sourceMetadata.sourceCommit,
    "M5/M6 walkthrough source commit differs from the canonical build metadata.");
  assert.equal(walkthrough.applicationSha256, sourceMetadata.applicationSha256,
    "M5/M6 walkthrough application differs from the canonical build metadata.");
  for (const screenshot of walkthrough.screenshots) {
    const path = join(screenshotsDirectory, screenshot.file);
    const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
    assert.equal(metadata.size, screenshot.bytes, `${screenshot.file} byte count differs from its manifest.`);
    assert.equal(sha256(bytes), screenshot.sha256, `${screenshot.file} hash differs from its manifest.`);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${screenshot.file} is not a PNG.`);
  }
  return {
    schemaVersion: 1,
    status: "passed",
    walkthroughSha256: sha256(walkthroughBytes),
    sourceMetadataSha256: sha256(sourceMetadataBytes),
    sourceCommit: walkthrough.sourceCommit,
    applicationSha256: walkthrough.applicationSha256,
    capabilityCount: walkthrough.capabilities.length,
    screenshotCount: walkthrough.screenshots.length,
  };
}
