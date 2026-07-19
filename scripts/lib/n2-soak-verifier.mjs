import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  aggregateN2ProcessMemory,
  summarizeN2Memory,
  validateN2SoakConfiguration,
  validateN2SoakSummary,
} from "./n2-soak-evidence.mjs";

const SOAK_EVENTS = new Set([
  "n2-soak-disabled",
  "n2-accelerated-non-release-soak-passed",
  "n2-literal-eight-hour-soak-passed",
]);
const CRASH_SOURCE = "$fn=400; minkowski() { sphere(10); cube([20,20,20], center=true); } // N2-ENGINE-CRASH";

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readRequired(path, label) {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`Retained N-2 ${label} is missing or unreadable.`, { cause: error });
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function expectedEventName(mode) {
  if (mode === "disabled") return "n2-soak-disabled";
  return mode === "literal"
    ? "n2-literal-eight-hour-soak-passed"
    : "n2-accelerated-non-release-soak-passed";
}

function requireModeEvent(events, configuration) {
  if (!Array.isArray(events)) throw new Error("Retained N-2 evidence events are missing.");
  const candidates = events.filter(({ name } = {}) => SOAK_EVENTS.has(name));
  const expected = expectedEventName(configuration.mode);
  if (candidates.length !== 1 || candidates[0].name !== expected) {
    throw new Error(`Retained N-2 evidence must contain exactly one ${expected} event.`);
  }
  return candidates[0];
}

function parseJsonLines(bytes) {
  if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1_024 * 1_024 || bytes.at(-1) !== 0x0a) {
    throw new Error("Retained N-2 JSONL has an invalid byte envelope.");
  }
  return bytes.toString("utf8").trimEnd().split("\n").map((line) => {
    if (Buffer.byteLength(`${line}\n`) > 8 * 1_024) throw new Error("Retained N-2 JSONL line exceeds its bound.");
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error("Retained N-2 JSONL contains invalid JSON.", { cause: error });
    }
  });
}

function normalizedPath(value) {
  return typeof value === "string" ? win32.normalize(value).toLowerCase() : null;
}

function auditedMemory(records, events) {
  const rows = records.filter(({ kind } = {}) => kind === "memory-sample");
  if (rows.length === 0) throw new Error("Retained N-2 JSONL has no memory samples.");
  const artifactEvents = events.filter(({ name } = {}) => name === "artifacts-verified");
  const artifact = artifactEvents[0];
  if (
    artifactEvents.length !== 1
    || typeof artifact?.app?.path !== "string"
    || !validSha(artifact.app.sha256)
    || artifact.source?.applicationSha256?.toLowerCase() !== artifact.app.sha256.toLowerCase()
    || typeof artifact?.webView?.path !== "string"
    || !validSha(artifact.webView.executableSha256)
  ) throw new Error("Retained N-2 artifacts-verified application/WebView binding is invalid.");
  const expectedWebViewPath = win32.join(artifact.webView.path, "msedgewebview2.exe");
  const firstGui = rows[0]?.application?.[0];
  const expectedGuiIdentity = {
    pid: firstGui?.pid,
    path: firstGui?.path,
    startedAt: firstGui?.startedAt,
  };
  const samples = rows.map((row) => {
    const aggregate = aggregateN2ProcessMemory({
      applicationProcesses: row.application,
      webViewProcesses: row.webView,
      expectedGuiIdentity,
    });
    if (aggregate.webView.some(({ path }) => normalizedPath(path) !== normalizedPath(expectedWebViewPath))) {
      throw new Error("Retained N-2 WebView executable path differs from artifacts-verified.");
    }
    if (
      row.applicationProcessCount !== aggregate.applicationProcessCount
      || row.webViewProcessCount !== aggregate.webViewProcessCount
      || row.privateBytes !== aggregate.privateBytes
      || row.workingSetBytes !== aggregate.workingSetBytes
      || !Number.isFinite(Date.parse(row.sampledAt))
      || normalizedPath(aggregate.application[0].path) !== normalizedPath(artifact.app.path)
    ) throw new Error("Retained N-2 memory sample does not match its exact processes.");
    return {
      elapsedSeconds: row.elapsedSeconds,
      privateBytes: row.privateBytes,
      workingSetBytes: row.workingSetBytes,
    };
  });
  return { rows, samples, expectedGuiIdentity };
}

function auditedCycles(records, summary, configuration) {
  const cycles = records.filter(({ kind } = {}) => kind === "cycle");
  const soakStartMs = Date.parse(summary.startedAt);
  let priorStartedAtMs = null;
  let priorCompletedAtMs = null;
  let priorConsoleCount = null;
  let priorRecordIndex = null;
  let maximumStartGapMs = 0;
  for (const [index, cycle] of cycles.entries()) {
    const sequence = index + 1;
    const size = 10 + (sequence % 10);
    const expectedSource = `cube([${size}, 10, 10]); // n2-soak-${sequence}`;
    const recordIndex = records.indexOf(cycle);
    const interveningCrashes = priorRecordIndex === null
      ? 0
      : records.slice(priorRecordIndex + 1, recordIndex)
        .filter(({ kind } = {}) => kind === "expected-engine-crash").length;
    const startedAtMs = Date.parse(cycle.startedAt);
    const completedAtMs = Date.parse(cycle.completedAt);
    if (
      !exactKeys(cycle, [
        "completedAt", "consoleRun", "durationMilliseconds", "elapsedSeconds", "engineProcessesAfterRender",
        "expectedBoundsText", "kind", "sequence", "sourceSha256", "startedAt",
      ])
      || cycle.sequence !== sequence
      || !Number.isFinite(startedAtMs)
      || !Number.isFinite(completedAtMs)
      || completedAtMs < startedAtMs
      || cycle.durationMilliseconds !== completedAtMs - startedAtMs
      || cycle.elapsedSeconds !== (completedAtMs - soakStartMs) / 1_000
      || cycle.sourceSha256 !== sha256(expectedSource)
      || cycle.expectedBoundsText !== `${size} × 10 × 10 mm`
      || !exactKeys(cycle.consoleRun, ["count", "label"])
      || !Number.isSafeInteger(cycle.consoleRun.count)
      || cycle.consoleRun.count <= 0
      || (priorConsoleCount !== null && cycle.consoleRun.count !== priorConsoleCount + 1 + interveningCrashes)
      || typeof cycle.consoleRun.label !== "string"
      || !cycle.consoleRun.label.includes("exit 0")
      || cycle.consoleRun.label.includes("running")
      || cycle.engineProcessesAfterRender !== 0
      || (priorCompletedAtMs !== null && startedAtMs < priorCompletedAtMs)
    ) throw new Error("Retained N-2 cycle proof is invalid.");
    if (priorStartedAtMs !== null) maximumStartGapMs = Math.max(maximumStartGapMs, startedAtMs - priorStartedAtMs);
    priorStartedAtMs = startedAtMs;
    priorCompletedAtMs = completedAtMs;
    priorConsoleCount = cycle.consoleRun.count;
    priorRecordIndex = recordIndex;
  }
  if (
    cycles.length !== summary.cycles.successful
    || cycles[0]?.startedAt !== summary.continuity.firstStartedAt
    || cycles.at(-1)?.completedAt !== summary.continuity.lastCompletedAt
    || maximumStartGapMs !== summary.continuity.maximumStartGapMs
    || summary.continuity.overlappingRequests !== 0
    || Date.parse(summary.completedAt) - soakStartMs !== summary.durationSeconds * 1_000
  ) throw new Error("Retained N-2 cycle continuity differs from the summary.");
  const firstStartOffsetMs = Date.parse(cycles[0]?.startedAt) - soakStartMs;
  const finalElapsedSeconds = cycles.at(-1)?.elapsedSeconds;
  if (
    firstStartOffsetMs < 0
    || firstStartOffsetMs > configuration.cadenceMilliseconds
    || finalElapsedSeconds < summary.durationSeconds - configuration.cadenceMilliseconds / 1_000
    || finalElapsedSeconds > summary.durationSeconds + 90
  ) throw new Error("Retained N-2 cycle boundary coverage does not span the soak.");
  return cycles;
}

function auditedTimeline(records, summary) {
  const soakStartMs = Date.parse(summary.startedAt);
  let priorElapsedSeconds = -1;
  for (const record of records) {
    if (
      typeof record?.elapsedSeconds !== "number"
      || !Number.isFinite(record.elapsedSeconds)
      || record.elapsedSeconds < priorElapsedSeconds
      || (record.kind === "memory-sample"
        && Math.abs(Date.parse(record.sampledAt) - soakStartMs - record.elapsedSeconds * 1_000) > 0.001)
    ) throw new Error("Retained N-2 JSONL timeline is not globally chronological.");
    priorElapsedSeconds = record.elapsedSeconds;
  }
  if (records[0]?.kind !== "cycle") {
    throw new Error("Retained N-2 JSONL timeline must begin with the first cycle.");
  }
}

function auditedCrash(records, configuration, summary, events) {
  const crashes = records.filter(({ kind } = {}) => kind === "expected-engine-crash");
  const artifactEvents = events.filter(({ name } = {}) => name === "artifacts-verified");
  const crash = crashes[0];
  const crashIndex = records.indexOf(crash);
  const priorCycle = records.slice(0, crashIndex).findLast(({ kind } = {}) => kind === "cycle");
  const nextCycle = records.slice(crashIndex + 1).find(({ kind } = {}) => kind === "cycle");
  const artifactEngine = artifactEvents[0]?.engine;
  if (
    crashes.length !== 1
    || artifactEvents.length !== 1
    || !exactKeys(crash, [
      "elapsedSeconds", "engine", "engineCleared", "guiIdentityPreserved", "kind", "sourceSha256", "visibleAlerts",
    ])
    || typeof crash.elapsedSeconds !== "number"
    || !Number.isFinite(crash.elapsedSeconds)
    || crash.elapsedSeconds < configuration.crashAtSeconds
    || crash.elapsedSeconds > configuration.crashAtSeconds + 90
    || priorCycle?.sequence + 1 !== nextCycle?.sequence
    || crash.elapsedSeconds < priorCycle?.elapsedSeconds
    || nextCycle?.elapsedSeconds - crash.elapsedSeconds > 90
    || crash.sourceSha256 !== sha256(CRASH_SOURCE)
    || !exactKeys(crash.engine, ["executableSha256", "path", "pid", "startedAt"])
    || !Number.isSafeInteger(crash.engine.pid)
    || crash.engine.pid <= 0
    || typeof crash.engine.path !== "string"
    || crash.engine.path.length === 0
    || !Number.isFinite(Date.parse(crash.engine.startedAt))
    || !validSha(crash.engine.executableSha256)
    || crash.engine.path !== artifactEngine?.path
    || crash.engine.executableSha256.toLowerCase() !== artifactEngine?.sha256?.toLowerCase()
    || !Array.isArray(crash.visibleAlerts)
    || crash.visibleAlerts.length === 0
    || crash.visibleAlerts.some((alert) => typeof alert !== "string" || alert.length === 0)
    || crash.guiIdentityPreserved !== true
    || crash.engineCleared !== true
    || summary.crashProbe?.attempted !== true
    || summary.crashProbe?.engineKilled !== true
    || summary.crashProbe?.guiIdentityPreserved !== true
    || summary.crashProbe?.engineCleared !== true
    || summary.crashProbe?.recoveryCyclePassed !== true
  ) throw new Error("Retained N-2 crash proof is invalid.");
  return crash;
}

function auditedOrphans(summary, expectedGuiIdentity) {
  const orphans = summary.orphans;
  if (
    !exactKeys(orphans, ["engineProcesses", "guiIdentity", "guiIdentityPreserved", "passed"])
    || orphans.passed !== true
    || !Array.isArray(orphans.engineProcesses)
    || orphans.engineProcesses.length !== 0
    || orphans.guiIdentityPreserved !== true
    || !exactKeys(orphans.guiIdentity, ["path", "pid", "startedAt"])
    || !isDeepStrictEqual(orphans.guiIdentity, expectedGuiIdentity)
  ) throw new Error("Retained N-2 final orphan proof is invalid.");
}

function requireEventConsistency(event, summary, summarySha256, samplesSha256) {
  if (
    event.releaseEvidenceEligible !== summary.configuration.releaseEvidenceEligible
    || event.evidenceLabel !== summary.configuration.evidenceLabel
    || event.durationSeconds !== summary.durationSeconds
    || event.successfulCycles !== summary.cycles.successful
    || event.finalMemoryRatio !== summary.memory.finalRatio
    || event.summarySha256?.toLowerCase() !== summarySha256
    || event.samplesSha256?.toLowerCase() !== samplesSha256
  ) throw new Error("Retained N-2 soak event does not match its artifacts.");
}

function requireFinalEvent(events, result) {
  const matches = events.filter(({ name } = {}) => name === "n2-final-artifacts-verified");
  if (matches.length !== 1) throw new Error("Guest PASS lacks one final N-2 artifact-verification event.");
  const event = matches[0];
  for (const key of ["mode", "configurationSha256", "summarySha256", "samplesSha256", "recordCount", "memorySampleCount"]) {
    if ((event[key] ?? null) !== (result[key] ?? null)) {
      throw new Error(`Guest final N-2 verification event changed at ${key}.`);
    }
  }
}

export async function verifyN2SoakArtifacts(input) {
  const configurationBytes = await readRequired(input?.configurationPath, "configuration");
  const configurationSha256 = sha256(configurationBytes);
  if (configurationSha256 !== input?.expectedConfigurationSha256?.toLowerCase()) {
    throw new Error("Retained N-2 configuration hash does not match the manifest.");
  }
  let configuration;
  try {
    configuration = validateN2SoakConfiguration(JSON.parse(configurationBytes.toString("utf8")));
  } catch (error) {
    throw new Error("Retained N-2 configuration is invalid.", { cause: error });
  }
  const modeEvent = requireModeEvent(input.events, configuration);
  if (configuration.mode === "disabled") {
    if (modeEvent.releaseEvidenceEligible !== false || Object.hasOwn(modeEvent, "evidenceLabel")) {
      throw new Error("Retained N-2 disabled event has conflicting release evidence fields.");
    }
    if (await exists(input.summaryPath) || await exists(input.samplePath)) {
      throw new Error("Disabled N-2 evidence must not retain summary or JSONL artifacts.");
    }
    const result = {
      schemaVersion: 1,
      status: "passed",
      mode: "disabled",
      configurationSha256,
      summarySha256: null,
      samplesSha256: null,
      recordCount: 0,
      memorySampleCount: 0,
    };
    if (input.requireFinalEvent) requireFinalEvent(input.events, result);
    return result;
  }

  const [summaryBytes, sampleBytes] = await Promise.all([
    readRequired(input.summaryPath, "summary"),
    readRequired(input.samplePath, "JSONL"),
  ]);
  let summary;
  try {
    summary = JSON.parse(summaryBytes.toString("utf8"));
  } catch (error) {
    throw new Error("Retained N-2 summary is invalid JSON.", { cause: error });
  }
  validateN2SoakSummary(summary, { requireReleaseEvidence: configuration.mode === "literal" });
  if (!isDeepStrictEqual(summary.configuration, configuration)) {
    throw new Error("Retained N-2 summary configuration differs from the manifest-bound configuration.");
  }
  const records = parseJsonLines(sampleBytes);
  const kinds = records.map(({ kind } = {}) => kind);
  if (kinds.some((kind) => !["cycle", "expected-engine-crash", "memory-sample"].includes(kind))) {
    throw new Error("Retained N-2 JSONL contains an unknown record kind.");
  }
  const cycleCount = kinds.filter((kind) => kind === "cycle").length;
  const crashCount = kinds.filter((kind) => kind === "expected-engine-crash").length;
  auditedTimeline(records, summary);
  auditedCycles(records, summary, configuration);
  auditedCrash(records, configuration, summary, input.events);
  const memory = auditedMemory(records, input.events);
  auditedOrphans(summary, memory.expectedGuiIdentity);
  const recomputedMemory = summarizeN2Memory(memory.samples, configuration);
  const summarySha256 = sha256(summaryBytes);
  const samplesSha256 = sha256(sampleBytes);
  if (
    cycleCount !== summary.cycles.successful
    || crashCount !== 1
    || records.length !== summary.samples.recordCount
    || memory.rows.length !== summary.samples.memorySampleCount
    || summary.samples.path !== "n2-soak-samples.jsonl"
    || summary.samples.byteLength !== sampleBytes.byteLength
    || summary.samples.sha256?.toLowerCase() !== samplesSha256
    || !isDeepStrictEqual(summary.memory, recomputedMemory)
  ) throw new Error("Retained N-2 JSONL and summary are inconsistent.");
  requireEventConsistency(modeEvent, summary, summarySha256, samplesSha256);
  const result = {
    schemaVersion: 1,
    status: "passed",
    mode: configuration.mode,
    configurationSha256,
    summarySha256,
    samplesSha256,
    recordCount: records.length,
    memorySampleCount: memory.rows.length,
  };
  if (input.requireFinalEvent) requireFinalEvent(input.events, result);
  return result;
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error(`Invalid N-2 verifier argument near ${name ?? "end"}.`);
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

async function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const [manifest, evidence] = await Promise.all([
    readRequired(args.manifest, "harness manifest").then((bytes) => JSON.parse(bytes.toString("utf8"))),
    readRequired(args.evidence, "guest evidence").then((bytes) => JSON.parse(bytes.toString("utf8"))),
  ]);
  return verifyN2SoakArtifacts({
    configurationPath: args.configuration,
    summaryPath: args.summary,
    samplePath: args.samples,
    expectedConfigurationSha256: manifest?.files?.n2SoakConfiguration?.sha256,
    events: evidence?.events,
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
