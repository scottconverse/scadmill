import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectM4Png } from "./m4-packaged-walkthrough.mjs";

const SCREENSHOTS = [
  "04a-ai-unconfigured.png",
  "04b-ai-proposal-applied.png",
  "04c-ai-agent-pending-diff.png",
  "04d-cache-geometry-delta.png",
  "04e-animation-frame-52.png",
  "04f-file-tree-thumbnail.png",
  "04g-welcome-recent-thumbnail.png",
  "04h-cold-cache-restored-thumbnail.png",
];
const ORDER = [
  "c10-unconfigured", "c10-proposal", "c10-agent", "c10-agent-cap", "c11-default-deny",
  "c11-allow-session", "cache", "delta", "animation", "thumbnail", "restart", "source-restored",
];
const NATIVE_SCREENSHOTS = [
  "04a-ai-unconfigured.png",
  "04d-cache-geometry-delta.png",
  "04e-animation-frame-52.png",
  "04f-file-tree-thumbnail.png",
  "04g-welcome-recent-thumbnail.png",
  "04h-cold-cache-restored-thumbnail.png",
];
const NATIVE_ORDER = [
  "c10-unconfigured", "c11-default-deny", "c11-allow-session", "cache", "delta",
  "animation", "thumbnail", "restart", "source-restored",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}

function validGeometryIdentity(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function required(path, label) {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`Retained M4 ${label} is missing or unreadable.`, { cause: error });
  }
}

function requireWalkthroughShape(value) {
  if (!exactKeys(value, ["schemaVersion", "status", "order", "ai", "mcp", "cache", "delta", "animation", "thumbnails", "restart", "screenshots", "source"])
    || ![1, 2].includes(value.schemaVersion) || value.status !== "passed") throw new Error("Retained M4 walkthrough has an invalid top-level schema.");
  const nativeOnly = value.schemaVersion === 2;
  if (JSON.stringify(value.order) !== JSON.stringify(nativeOnly ? NATIVE_ORDER : ORDER)) throw new Error("Retained M4 walkthrough order is invalid.");
  const ai = value.ai;
  if (nativeOnly) {
    if (!exactKeys(ai, ["mode", "unconfiguredRequestCount", "unconfiguredRendererAttempts", "unconfiguredRendererExternalAttempts", "unconfiguredRendererInternalAttempts", "unconfiguredRendererObservations", "unconfiguredTauriInvokeAttempts", "unconfiguredInvokeMonitoring", "requestCount", "hostedAutomationRequired", "manualPackagedInputRequired"])
      || ai.mode !== "hosted-plus-manual" || ai.unconfiguredRequestCount !== 0
      || !Number.isSafeInteger(ai.unconfiguredRendererAttempts) || ai.unconfiguredRendererAttempts < 0
      || ai.unconfiguredRendererExternalAttempts !== 0
      || !Number.isSafeInteger(ai.unconfiguredRendererInternalAttempts) || ai.unconfiguredRendererInternalAttempts < 0
      || ai.unconfiguredRendererAttempts !== ai.unconfiguredRendererInternalAttempts
      || !Array.isArray(ai.unconfiguredRendererObservations)
      || ai.unconfiguredRendererObservations.length !== ai.unconfiguredRendererAttempts
      || ai.unconfiguredRendererObservations.some((observation) =>
        !exactKeys(observation, ["command", "kind", "method", "origin", "targetClass"])
        || !["fetch", "xhr"].includes(observation.kind)
        || typeof observation.method !== "string" || !/^[A-Z]{1,16}$/u.test(observation.method)
        || typeof observation.origin !== "string" || observation.origin.length === 0 || observation.origin.length > 256
        || !["tauri-ipc", "same-origin", "local-scheme"].includes(observation.targetClass)
        || (observation.targetClass === "tauri-ipc" && observation.command === "ai_http_request")
        || (observation.command !== null && (typeof observation.command !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(observation.command))))
      || !["installed", "protected-nonwritable", "patch-failed"].includes(ai.unconfiguredInvokeMonitoring)
      || ai.unconfiguredTauriInvokeAttempts !== (ai.unconfiguredInvokeMonitoring === "installed" ? 0 : null)
      || ai.requestCount !== 0 || ai.hostedAutomationRequired !== true
      || ai.manualPackagedInputRequired !== true) throw new Error("Retained native-only M4 AI boundary evidence is invalid.");
  } else {
  const expectedContexts = [
    { source: true, diagnostics: true, parameters: true, screenshot: true },
    ...Array.from({ length: 4 }, () => ({ source: false, diagnostics: false, parameters: false, screenshot: false })),
    ...Array.from({ length: 2 }, () => ({ source: true, diagnostics: false, parameters: false, screenshot: false })),
  ];
  if (!exactKeys(ai, ["unconfiguredRequestCount", "unconfiguredRendererAttempts", "unconfiguredRendererExternalAttempts", "unconfiguredRendererInternalAttempts", "unconfiguredRendererObservations", "unconfiguredTauriInvokeAttempts", "unconfiguredInvokeMonitoring", "requestCount", "proposalAccepted", "agentStatus", "capStatus", "capToolRounds", "selectedResponseToolSequence", "contextPatterns", "semanticTranscript", "transcript"])
    || ai.unconfiguredRequestCount !== 0
    || !Number.isSafeInteger(ai.unconfiguredRendererAttempts) || ai.unconfiguredRendererAttempts < 0
    || ai.unconfiguredRendererExternalAttempts !== 0
    || !Number.isSafeInteger(ai.unconfiguredRendererInternalAttempts) || ai.unconfiguredRendererInternalAttempts < 0
    || ai.unconfiguredRendererAttempts !== ai.unconfiguredRendererInternalAttempts
    || !Array.isArray(ai.unconfiguredRendererObservations)
    || ai.unconfiguredRendererObservations.length !== ai.unconfiguredRendererAttempts
    || ai.unconfiguredRendererObservations.some((observation) =>
      !exactKeys(observation, ["command", "kind", "method", "origin", "targetClass"])
      || !["fetch", "xhr"].includes(observation.kind)
      || typeof observation.method !== "string" || !/^[A-Z]{1,16}$/u.test(observation.method)
      || typeof observation.origin !== "string" || observation.origin.length === 0 || observation.origin.length > 256
      || !["tauri-ipc", "same-origin", "local-scheme"].includes(observation.targetClass)
      || (observation.targetClass === "tauri-ipc" && observation.command === "ai_http_request")
      || (observation.command !== null && (typeof observation.command !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(observation.command))))
    || !["installed", "protected-nonwritable", "patch-failed"].includes(ai.unconfiguredInvokeMonitoring)
    || ai.unconfiguredTauriInvokeAttempts !== (ai.unconfiguredInvokeMonitoring === "installed" ? 0 : null)
    || ai.requestCount !== 7
    || ai.proposalAccepted !== true || ai.agentStatus !== "completed" || ai.capStatus !== "capped" || ai.capToolRounds !== 2
    || JSON.stringify(ai.selectedResponseToolSequence) !== JSON.stringify([null, "render_preview", "get_diagnostics", "write_file", null, "render_preview", "render_preview"])
    || JSON.stringify(ai.contextPatterns) !== JSON.stringify(expectedContexts)
    || !exactKeys(ai.transcript, ["records", "sha256"]) || !validSha(ai.transcript.sha256)
    || !Array.isArray(ai.transcript.records) || ai.transcript.records.length !== 7) throw new Error("Retained M4 AI evidence is invalid.");
  const semantic = ai.semanticTranscript;
  if (!exactKeys(semantic, ["contextSourceSha256", "contextScreenshotSha256", "contextScreenshotWidth", "contextScreenshotHeight", "renderTriangles", "diagnosticCount", "agentRenderConsoleRunsAdded"])
    || !validSha(semantic.contextSourceSha256) || !validSha(semantic.contextScreenshotSha256)
    || !Number.isSafeInteger(semantic.contextScreenshotWidth) || semantic.contextScreenshotWidth <= 0
    || !Number.isSafeInteger(semantic.contextScreenshotHeight) || semantic.contextScreenshotHeight <= 0
    || !Number.isSafeInteger(semantic.renderTriangles) || semantic.renderTriangles <= 0
    || !Number.isSafeInteger(semantic.diagnosticCount) || semantic.diagnosticCount < 0
    || semantic.agentRenderConsoleRunsAdded !== 1) throw new Error("Retained M4 semantic transcript evidence is invalid.");
  for (const [index, record] of ai.transcript.records.entries()) {
    if (!exactKeys(record, ["ordinal", "method", "path", "model", "roles", "toolNames", "responseToolName", "context", "bodySha256", "responseSha256", "authorizationPresent", "authorizationSha256"])
      || record.ordinal !== index + 1 || record.method !== "POST" || record.path !== "/api/chat"
      || !validSha(record.bodySha256) || !validSha(record.responseSha256) || !validSha(record.authorizationSha256)
      || record.authorizationPresent !== true || JSON.stringify(record.context) !== JSON.stringify(expectedContexts[index])
      || !Array.isArray(record.roles) || record.roles.some((role) => !["system", "user", "assistant", "tool"].includes(role))
      || !Array.isArray(record.toolNames) || record.toolNames.some((name) => typeof name !== "string")
      || record.responseToolName !== ai.selectedResponseToolSequence[index]
      || (record.responseToolName !== null && !record.toolNames.includes(record.responseToolName))) throw new Error("Retained M4 sanitized transcript is invalid.");
  }
  if (sha256(canonicalJson(ai.transcript.records)) !== ai.transcript.sha256) throw new Error("Retained M4 sanitized transcript hash is invalid.");
  }
  if (!exactKeys(value.mcp, ["defaultDenyCode", "mutationApproved"])
    || value.mcp.defaultDenyCode !== -32001 || value.mcp.mutationApproved !== true) throw new Error("Retained M4 MCP evidence is invalid.");
  if (!exactKeys(value.cache, ["baselineConsoleRunsAdded", "elapsedMs", "consoleRunsAdded", "coldElapsedMs", "restoredAfterRestart"])
    || value.cache.baselineConsoleRunsAdded !== 1 || value.cache.consoleRunsAdded !== 0
    || value.cache.restoredAfterRestart !== true || !Number.isFinite(value.cache.elapsedMs) || value.cache.elapsedMs < 0 || value.cache.elapsedMs >= 100
    || !Number.isFinite(value.cache.coldElapsedMs) || value.cache.coldElapsedMs < 0 || value.cache.coldElapsedMs >= 100) throw new Error("Retained M4 cache evidence is invalid.");
  if (JSON.stringify(value.delta) !== JSON.stringify({ unchanged: true, volumeDeltaMm3: 200, boundsDeltaMm: [2, 0, 0] })) throw new Error("Retained M4 delta evidence is invalid.");
  if (!exactKeys(value.animation, ["frame", "time", "fps", "scrubConsoleRunsAdded", "playConsoleRunsAdded", "serialized"])
    || value.animation.frame !== 52 || value.animation.time !== 0.51 || value.animation.fps !== 24
    || value.animation.scrubConsoleRunsAdded !== 1 || value.animation.playConsoleRunsAdded !== 1 || value.animation.serialized !== true) throw new Error("Retained M4 animation evidence is invalid.");
  if (!exactKeys(value.thumbnails, ["documentPath", "renderIdentity", "pngSha256", "byteLength", "width", "height", "persistedAcrossRestart"])
    || value.thumbnails.documentPath !== "main.scad" || !validGeometryIdentity(value.thumbnails.renderIdentity) || !validSha(value.thumbnails.pngSha256)
    || !Number.isSafeInteger(value.thumbnails.byteLength) || value.thumbnails.byteLength <= 0
    || value.thumbnails.width !== 240 || value.thumbnails.height !== 160 || value.thumbnails.persistedAcrossRestart !== true) throw new Error("Retained M4 thumbnail evidence is invalid.");
  if (!exactKeys(value.restart, ["beforePid", "afterPid", "freshWebViewProcesses", "persistedThumbnailSha256"])
    || !Number.isSafeInteger(value.restart.beforePid) || !Number.isSafeInteger(value.restart.afterPid)
    || value.restart.beforePid <= 0 || value.restart.afterPid <= 0
    || value.restart.beforePid === value.restart.afterPid || value.restart.freshWebViewProcesses !== true
    || !validSha(value.restart.persistedThumbnailSha256)
    || value.restart.persistedThumbnailSha256 !== value.thumbnails.pngSha256) throw new Error("Retained M4 restart evidence is invalid.");
  if (!exactKeys(value.source, ["initialSha256", "restoredSha256", "restoredExactly"])
    || !validSha(value.source.initialSha256) || value.source.restoredSha256 !== value.source.initialSha256
    || value.source.restoredExactly !== true) throw new Error("Retained M4 source restoration is invalid.");
  return value;
}

function initialEvent(events) {
  const matches = events.filter(({ name } = {}) => name === "m4-packaged-newcomer-walkthrough-passed");
  if (matches.length !== 1) throw new Error("Retained evidence must contain exactly one M4 walkthrough event.");
  return matches[0];
}

function validObservedAt(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function requireCleanupEvent(events, initial) {
  const matches = events.filter(({ name } = {}) => ["m4-helper-secret-cleared-and-scanned", "m4-ai-sensitive-state-scanned"].includes(name));
  if (matches.length !== 1) throw new Error("Retained evidence must contain exactly one M4 helper-secret cleanup event.");
  const cleanup = matches[0];
  if (!exactKeys(cleanup, ["name", "observedAt", "credential", "roots", "filesScanned", "bytesScanned", "matches", "unreadableAppFiles", "secretSha256"])
    || !validObservedAt(initial.observedAt) || !validObservedAt(cleanup.observedAt)
    || !exactKeys(cleanup.credential, ["target", "found", "lastError"])
    || cleanup.credential.target !== "ai-api-key.dev.scadmill.app"
    || cleanup.credential.found !== false || cleanup.credential.lastError !== 1168
    || !Array.isArray(cleanup.roots) || cleanup.roots.length !== 4
    || cleanup.roots.some((root) => typeof root !== "string" || root.length === 0 || root.length > 32_767)
    || new Set(cleanup.roots.map((root) => root.toLowerCase())).size !== cleanup.roots.length
    || !Number.isSafeInteger(cleanup.filesScanned) || cleanup.filesScanned <= 0 || cleanup.filesScanned > 10_000_000
    || !Number.isSafeInteger(cleanup.bytesScanned) || cleanup.bytesScanned <= 0 || cleanup.bytesScanned > 2 ** 50
    || !Array.isArray(cleanup.matches) || cleanup.matches.length !== 0
    || !Array.isArray(cleanup.unreadableAppFiles) || cleanup.unreadableAppFiles.length !== 0
    || !validSha(cleanup.secretSha256)) throw new Error("Retained M4 helper-secret cleanup evidence is invalid.");
  if (!validSha(initial.secretSha256) || cleanup.secretSha256 !== initial.secretSha256) {
    throw new Error("Retained M4 helper-secret cleanup secret hash differs from the walkthrough event.");
  }
  const initialIndex = events.indexOf(initial);
  const cleanupIndex = events.indexOf(cleanup);
  if (initialIndex < 0 || cleanupIndex <= initialIndex || Date.parse(cleanup.observedAt) < Date.parse(initial.observedAt)) {
    throw new Error("Retained M4 event chronology is invalid.");
  }
  return cleanup;
}

function requireFinalEvent(events, result, cleanup) {
  const matches = events.filter(({ name } = {}) => name === "m4-final-artifacts-verified");
  if (matches.length !== 1) throw new Error("Guest PASS lacks exactly one final M4 artifact-verification event.");
  if (!exactKeys(matches[0], ["name", "observedAt", "schemaVersion", "status", "walkthroughSha256", "screenshotCount", "screenshotsSha256"])
    || !validObservedAt(matches[0].observedAt)) throw new Error("Guest final M4 verification event has an invalid shape.");
  for (const key of ["schemaVersion", "status", "walkthroughSha256", "screenshotCount", "screenshotsSha256"]) {
    if (matches[0][key] !== result[key]) throw new Error(`Guest final M4 verification event changed at ${key}.`);
  }
  if (events.indexOf(matches[0]) <= events.indexOf(cleanup)
    || Date.parse(matches[0].observedAt) < Date.parse(cleanup.observedAt)) throw new Error("Retained M4 event chronology is invalid.");
}

export async function verifyM4PackagedArtifacts(input) {
  if (!Array.isArray(input?.events)) throw new Error("Retained M4 evidence events are missing.");
  const walkthroughBytes = await required(input.walkthroughPath, "walkthrough JSON");
  const walkthroughSha256 = sha256(walkthroughBytes);
  let walkthrough;
  try {
    walkthrough = JSON.parse(walkthroughBytes.toString("utf8"));
  } catch (error) {
    throw new Error("Retained M4 walkthrough JSON is invalid.", { cause: error });
  }
  walkthrough = requireWalkthroughShape(walkthrough);
  const expectedScreenshots = walkthrough.schemaVersion === 2 ? NATIVE_SCREENSHOTS : SCREENSHOTS;
  const event = initialEvent(input.events);
  const cleanup = requireCleanupEvent(input.events, event);
  if (event.evidenceSha256?.toLowerCase() !== walkthroughSha256
    || event.requestCount !== walkthrough.ai.requestCount || event.screenshotCount !== expectedScreenshots.length
    || event.cachePaintMs !== walkthrough.cache.elapsedMs || event.coldCachePaintMs !== walkthrough.cache.coldElapsedMs) {
    throw new Error("Retained M4 walkthrough event differs from its artifact.");
  }
  if (!Array.isArray(walkthrough.screenshots) || walkthrough.screenshots.length !== expectedScreenshots.length
    || JSON.stringify(walkthrough.screenshots.map(({ name }) => name)) !== JSON.stringify(expectedScreenshots)) {
    throw new Error("Retained M4 screenshot manifest is invalid.");
  }
  const auditedScreenshots = [];
  for (const [index, screenshot] of walkthrough.screenshots.entries()) {
    if (!exactKeys(screenshot, ["name", "sha256", "byteLength"]) || screenshot.name !== expectedScreenshots[index]
      || !validSha(screenshot.sha256) || !Number.isSafeInteger(screenshot.byteLength)) throw new Error("Retained M4 screenshot entry is invalid.");
    const bytes = await required(join(input.screenshotDirectory, screenshot.name), `screenshot ${screenshot.name}`);
    const png = inspectM4Png(bytes, `Retained M4 screenshot ${screenshot.name}`, 16 * 1024 * 1024);
    if (png.sha256 !== screenshot.sha256 || png.byteLength !== screenshot.byteLength) throw new Error(`Retained M4 screenshot ${screenshot.name} differs from its manifest.`);
    auditedScreenshots.push(`${screenshot.name}:${png.sha256}`);
  }
  const result = {
    schemaVersion: 1,
    status: "passed",
    walkthroughSha256,
    screenshotCount: auditedScreenshots.length,
    screenshotsSha256: sha256(auditedScreenshots.join("\n")),
  };
  if (input.requireFinalEvent) requireFinalEvent(input.events, result, cleanup);
  return result;
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith("--") || !values[index + 1]) throw new Error("Invalid M4 verifier arguments.");
    parsed[values[index].slice(2)] = values[index + 1];
  }
  return parsed;
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const [manifestBytes, evidenceBytes] = await Promise.all([
    required(args.manifest, "harness manifest"),
    required(args.evidence, "guest evidence"),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const evidence = JSON.parse(evidenceBytes.toString("utf8"));
  const verifierPath = fileURLToPath(import.meta.url);
  const helperPath = join(dirname(verifierPath), "m4-packaged-walkthrough.mjs");
  if (sha256(await readFile(verifierPath)) !== manifest?.files?.m4PackagedVerifier?.sha256?.toLowerCase()
    || sha256(await readFile(helperPath)) !== manifest?.files?.m4PackagedWalkthrough?.sha256?.toLowerCase()) {
    throw new Error("Retained M4 host verifier differs from the manifest-bound harness.");
  }
  return verifyM4PackagedArtifacts({
    walkthroughPath: args.walkthrough,
    screenshotDirectory: args.screenshots,
    events: evidence.events,
    requireFinalEvent: true,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runCli().then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
