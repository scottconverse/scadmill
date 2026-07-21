import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { verifyM4PackagedArtifacts } from "../../scripts/lib/m4-packaged-verifier.mjs";

const SCREENSHOTS = [
  "04a-ai-unconfigured.png", "04b-ai-proposal-applied.png", "04c-ai-agent-pending-diff.png",
  "04d-cache-geometry-delta.png", "04e-animation-frame-52.png", "04f-file-tree-thumbnail.png",
  "04g-welcome-recent-thumbnail.png", "04h-cold-cache-restored-thumbnail.png",
];
const ORDER = [
  "c10-unconfigured", "c10-proposal", "c10-agent", "c10-agent-cap", "c11-default-deny",
  "c11-allow-session", "cache", "delta", "animation", "thumbnail", "restart", "source-restored",
];
const roots: string[] = [];

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.byteLength);
  output.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(output, 4);
  Buffer.from(data).copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return output;
}

function png(width: number, height: number, red: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) {
    pixels[row * (width * 4 + 1)] = 0;
    for (let column = 0; column < width; column += 1) {
      const offset = row * (width * 4 + 1) + 1 + column * 4;
      pixels.set([red, 0, 0, 255], offset);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function transcriptRecord(ordinal: number) {
  const responseTools = [null, "render_preview", "get_diagnostics", "write_file", null, "render_preview", "render_preview"];
  const responseToolName = responseTools[ordinal - 1];
  return {
    ordinal, method: "POST", path: "/api/chat", model: "m4-local", roles: ["system", "user"],
    toolNames: responseToolName ? [responseToolName] : [], responseToolName,
    context: { source: ordinal === 1 || ordinal >= 6, diagnostics: ordinal === 1, parameters: ordinal === 1, screenshot: ordinal === 1 },
    bodySha256: "a".repeat(64), responseSha256: "b".repeat(64), authorizationPresent: true, authorizationSha256: "c".repeat(64),
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "scadmill-m4-verifier-"));
  roots.push(root);
  const bytes = png(48, 32, 20);
  for (const name of SCREENSHOTS) await writeFile(join(root, name), bytes);
  const sourceSha = sha256("cube([10, 10, 10]);");
  const transcriptRecords = Array.from({ length: 7 }, (_, index) => transcriptRecord(index + 1));
  const walkthrough = {
    schemaVersion: 1,
    status: "passed",
    order: ORDER,
    ai: {
      unconfiguredRequestCount: 0,
      unconfiguredRendererAttempts: 1, unconfiguredRendererExternalAttempts: 0,
      unconfiguredRendererInternalAttempts: 1,
      unconfiguredRendererObservations: [{
        command: "update_native_menu_state", kind: "fetch", method: "POST",
        origin: "http://ipc.localhost", targetClass: "tauri-ipc",
      }],
      unconfiguredTauriInvokeAttempts: null, unconfiguredInvokeMonitoring: "protected-nonwritable",
      requestCount: 7,
      proposalAccepted: true, agentStatus: "completed", capStatus: "capped", capToolRounds: 2,
      selectedResponseToolSequence: [null, "render_preview", "get_diagnostics", "write_file", null, "render_preview", "render_preview"],
      contextPatterns: Array.from({ length: 7 }, (_, index) => ({ source: index === 0 || index >= 5, diagnostics: index === 0, parameters: index === 0, screenshot: index === 0 })),
      semanticTranscript: {
        contextSourceSha256: "d".repeat(64), contextScreenshotSha256: "e".repeat(64),
        contextScreenshotWidth: 48, contextScreenshotHeight: 32, renderTriangles: 12,
        diagnosticCount: 0, agentRenderConsoleRunsAdded: 1,
      },
      transcript: { records: transcriptRecords, sha256: sha256(canonicalJson(transcriptRecords)) },
    },
    mcp: { defaultDenyCode: -32001, mutationApproved: true },
    cache: { baselineConsoleRunsAdded: 1, elapsedMs: 42.25, consoleRunsAdded: 0, coldElapsedMs: 43.5, restoredAfterRestart: true },
    delta: { unchanged: true, volumeDeltaMm3: 200, boundsDeltaMm: [2, 0, 0] },
    animation: { frame: 52, time: 0.51, fps: 24, scrubConsoleRunsAdded: 1, playConsoleRunsAdded: 1, serialized: true },
    thumbnails: { documentPath: "main.scad", renderIdentity: `sha256:${"1".repeat(64)}`, pngSha256: "2".repeat(64), byteLength: 100, width: 240, height: 160, persistedAcrossRestart: true },
    restart: {
      beforePid: 100,
      afterPid: 200,
      freshWebViewProcesses: true,
      beforeCloseThumbnailSha256: "2".repeat(64),
      beforeCloseThumbnailRenderIdentity: `sha256:${"1".repeat(64)}`,
      persistedThumbnailSha256: "2".repeat(64),
      persistedThumbnailRenderIdentity: `sha256:${"1".repeat(64)}`,
    },
    screenshots: SCREENSHOTS.map((name) => ({ name, sha256: sha256(bytes), byteLength: bytes.byteLength })),
    source: { initialSha256: sourceSha, restoredSha256: sourceSha, restoredExactly: true },
  };
  const walkthroughPath = join(root, "m4-packaged-walkthrough.json");
  const serialized = `${JSON.stringify(walkthrough, null, 2)}\n`;
  await writeFile(walkthroughPath, serialized);
  const secretSha256 = "f".repeat(64);
  const initialEvent = {
    name: "m4-packaged-newcomer-walkthrough-passed", observedAt: "2026-07-19T06:00:00.000Z",
    evidenceSha256: sha256(serialized), requestCount: 7,
    cachePaintMs: 42.25, coldCachePaintMs: 43.5, screenshotCount: 8, secretSha256,
  };
  const cleanupEvent = {
    name: "m4-helper-secret-cleared-and-scanned", observedAt: "2026-07-19T06:00:01.000Z",
    credential: { target: "ai-api-key.dev.scadmill.app", found: false, lastError: 1168 },
    roots: ["C:\\Users\\sandbox\\AppData\\Roaming", "C:\\Users\\sandbox\\AppData\\Local", "C:\\Users\\sandbox\\Documents\\ScadMillM4Walkthrough", "C:\\Evidence"],
    filesScanned: 42, bytesScanned: 65_536, matches: [], unreadableAppFiles: [], secretSha256,
  };
  const events = [initialEvent, cleanupEvent];
  return { root, bytes, walkthrough, walkthroughPath, events, initialEvent, cleanupEvent };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("retained M4 packaged verifier", () => {
  it("accepts the native-only split while requiring hosted automation and manual packaged input", async () => {
    const value = await fixture();
    const nativeScreenshots = value.walkthrough.screenshots.filter(({ name }) =>
      !["04b-ai-proposal-applied.png", "04c-ai-agent-pending-diff.png"].includes(name));
    const native = {
      ...value.walkthrough,
      schemaVersion: 2,
      order: [
        "c10-unconfigured", "c11-default-deny", "c11-allow-session", "cache", "delta",
        "animation", "thumbnail", "restart", "source-restored",
      ],
      ai: {
        mode: "hosted-plus-manual",
        unconfiguredRequestCount: 0,
        unconfiguredRendererAttempts: 1,
        unconfiguredRendererExternalAttempts: 0,
        unconfiguredRendererInternalAttempts: 1,
        unconfiguredRendererObservations: [{
          command: "update_native_menu_state", kind: "fetch", method: "POST",
          origin: "http://ipc.localhost", targetClass: "tauri-ipc",
        }],
        unconfiguredTauriInvokeAttempts: null,
        unconfiguredInvokeMonitoring: "protected-nonwritable",
        requestCount: 0,
        hostedAutomationRequired: true,
        manualPackagedInputRequired: true,
      },
      screenshots: nativeScreenshots,
    };
    const serialized = `${JSON.stringify(native, null, 2)}\n`;
    await writeFile(value.walkthroughPath, serialized);
    const events = [
      {
        ...value.initialEvent,
        evidenceSha256: sha256(serialized),
        requestCount: 0,
        screenshotCount: nativeScreenshots.length,
      },
      { ...value.cleanupEvent, name: "m4-ai-sensitive-state-scanned" },
    ];
    await expect(verifyM4PackagedArtifacts({
      walkthroughPath: value.walkthroughPath,
      screenshotDirectory: value.root,
      events,
    })).resolves.toMatchObject({ status: "passed", screenshotCount: 6 });

    const missingManual = { ...native, ai: { ...native.ai, manualPackagedInputRequired: false } };
    const missingManualText = `${JSON.stringify(missingManual, null, 2)}\n`;
    await writeFile(value.walkthroughPath, missingManualText);
    await expect(verifyM4PackagedArtifacts({
      walkthroughPath: value.walkthroughPath,
      screenshotDirectory: value.root,
      events: [{ ...events[0], evidenceSha256: sha256(missingManualText) }, events[1]],
    })).rejects.toThrow("native-only M4 AI boundary evidence");
  });

  it("revalidates exact artifacts and rejects delete, truncate, replace, and threshold tampering", async () => {
    const value = await fixture();
    const input = { walkthroughPath: value.walkthroughPath, screenshotDirectory: value.root, events: value.events };
    const result = await verifyM4PackagedArtifacts(input);
    expect(result).toMatchObject({ status: "passed", screenshotCount: 8 });
    await expect(verifyM4PackagedArtifacts({ ...input, events: [value.initialEvent] })).rejects.toThrow("exactly one M4 helper-secret cleanup event");
    await expect(verifyM4PackagedArtifacts({ ...input, events: [...value.events, value.cleanupEvent] })).rejects.toThrow("exactly one M4 helper-secret cleanup event");
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [value.initialEvent, { ...value.cleanupEvent, matches: ["C:\\leaked-secret.txt"] }],
    })).rejects.toThrow("cleanup evidence is invalid");
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [value.initialEvent, { ...value.cleanupEvent, secretSha256: "0".repeat(64) }],
    })).rejects.toThrow("secret hash differs");
    await expect(verifyM4PackagedArtifacts({ ...input, requireFinalEvent: true })).rejects.toThrow("exactly one final M4");
    const finalEvent = { name: "m4-final-artifacts-verified", observedAt: "2026-07-19T06:00:02.000Z", ...result };
    await expect(verifyM4PackagedArtifacts({ ...input, events: [...value.events, finalEvent], requireFinalEvent: true })).resolves.toEqual(result);
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [value.initialEvent, finalEvent, value.cleanupEvent],
      requireFinalEvent: true,
    })).rejects.toThrow("M4 event chronology is invalid");
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [...value.events, { ...finalEvent, status: "failed" }],
      requireFinalEvent: true,
    })).rejects.toThrow("final M4 verification event changed");
    await expect(verifyM4PackagedArtifacts({ ...input, events: [...value.events, finalEvent, finalEvent], requireFinalEvent: true })).rejects.toThrow("exactly one final M4");

    const disguisedBroker = structuredClone(value.walkthrough);
    disguisedBroker.ai.unconfiguredRendererObservations[0].command = "ai_http_request";
    const disguisedBrokerText = `${JSON.stringify(disguisedBroker, null, 2)}\n`;
    await writeFile(value.walkthroughPath, disguisedBrokerText);
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [{ ...value.initialEvent, evidenceSha256: sha256(disguisedBrokerText) }, value.cleanupEvent],
    })).rejects.toThrow("AI evidence");
    await writeFile(value.walkthroughPath, `${JSON.stringify(value.walkthrough, null, 2)}\n`);

    const malformedIdentity = structuredClone(value.walkthrough);
    malformedIdentity.thumbnails.renderIdentity = `sha512:${"1".repeat(64)}`;
    const malformedIdentityText = `${JSON.stringify(malformedIdentity, null, 2)}\n`;
    await writeFile(value.walkthroughPath, malformedIdentityText);
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [{ ...value.initialEvent, evidenceSha256: sha256(malformedIdentityText) }, value.cleanupEvent],
    })).rejects.toThrow("thumbnail evidence");
    await writeFile(value.walkthroughPath, `${JSON.stringify(value.walkthrough, null, 2)}\n`);

    const replacedPersistedThumbnail = structuredClone(value.walkthrough);
    replacedPersistedThumbnail.restart.persistedThumbnailSha256 = "3".repeat(64);
    const replacedPersistedThumbnailText = `${JSON.stringify(replacedPersistedThumbnail, null, 2)}\n`;
    await writeFile(value.walkthroughPath, replacedPersistedThumbnailText);
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [{ ...value.initialEvent, evidenceSha256: sha256(replacedPersistedThumbnailText) }, value.cleanupEvent],
    })).rejects.toThrow("restart evidence");
    await writeFile(value.walkthroughPath, `${JSON.stringify(value.walkthrough, null, 2)}\n`);

    const replacedPersistedIdentity = structuredClone(value.walkthrough);
    replacedPersistedIdentity.restart.persistedThumbnailRenderIdentity = `sha256:${"4".repeat(64)}`;
    const replacedPersistedIdentityText = `${JSON.stringify(replacedPersistedIdentity, null, 2)}\n`;
    await writeFile(value.walkthroughPath, replacedPersistedIdentityText);
    await expect(verifyM4PackagedArtifacts({
      ...input,
      events: [{ ...value.initialEvent, evidenceSha256: sha256(replacedPersistedIdentityText) }, value.cleanupEvent],
    })).rejects.toThrow("restart evidence");
    await writeFile(value.walkthroughPath, `${JSON.stringify(value.walkthrough, null, 2)}\n`);

    const target = join(value.root, SCREENSHOTS[0]);
    await rm(target);
    await expect(verifyM4PackagedArtifacts(input)).rejects.toThrow("missing or unreadable");
    await writeFile(target, value.bytes.subarray(0, 33));
    await expect(verifyM4PackagedArtifacts(input)).rejects.toThrow("PNG size");
    await writeFile(target, png(48, 32, 99));
    await expect(verifyM4PackagedArtifacts(input)).rejects.toThrow("differs from its manifest");
    await writeFile(target, value.bytes);

    const slow = structuredClone(value.walkthrough);
    slow.cache.elapsedMs = 100;
    const slowText = `${JSON.stringify(slow, null, 2)}\n`;
    await writeFile(value.walkthroughPath, slowText);
    const slowEvents = [{ ...value.events[0], evidenceSha256: sha256(slowText), cachePaintMs: 100 }];
    await expect(verifyM4PackagedArtifacts({ ...input, events: slowEvents })).rejects.toThrow("cache evidence");
  });
});
