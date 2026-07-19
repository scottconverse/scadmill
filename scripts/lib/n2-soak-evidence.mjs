import { appendFile, stat } from "node:fs/promises";

const CONFIGURATION_KEYS = [
  "baselineEndSeconds",
  "baselineStartSeconds",
  "cadenceMilliseconds",
  "crashAtSeconds",
  "durationSeconds",
  "evidenceLabel",
  "finalWindowSamples",
  "memorySampleIntervalSeconds",
  "minimumSuccessfulCycles",
  "mode",
  "releaseEvidenceEligible",
  "rollingWindowSamples",
  "schemaVersion",
  "thresholdRatio",
  "warmupSeconds",
];

export const N2_LITERAL_CONFIGURATION = Object.freeze({
  schemaVersion: 1,
  mode: "literal",
  releaseEvidenceEligible: true,
  evidenceLabel: "N-2-LITERAL-1-HOUR",
  durationSeconds: 3_600,
  cadenceMilliseconds: 30_000,
  warmupSeconds: 300,
  baselineStartSeconds: 300,
  baselineEndSeconds: 900,
  crashAtSeconds: 1_800,
  minimumSuccessfulCycles: 113,
  memorySampleIntervalSeconds: 60,
  rollingWindowSamples: 5,
  finalWindowSamples: 10,
  thresholdRatio: 1.5,
});

export const N2_DISABLED_CONFIGURATION = Object.freeze({
  schemaVersion: 1,
  mode: "disabled",
  releaseEvidenceEligible: false,
  evidenceLabel: "DISABLED",
});

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return record(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function equalLiteralConfiguration(value) {
  return exactKeys(value, CONFIGURATION_KEYS)
    && CONFIGURATION_KEYS.every((key) => value[key] === N2_LITERAL_CONFIGURATION[key]);
}

export function validateN2SoakConfiguration(payload) {
  if (exactKeys(payload, Object.keys(N2_DISABLED_CONFIGURATION)) && payload.mode === "disabled") {
    if (
      payload.schemaVersion !== 1
      || payload.releaseEvidenceEligible !== false
      || payload.evidenceLabel !== "DISABLED"
    ) throw new Error("Disabled N-2 configuration is invalid.");
    return payload;
  }
  if (!exactKeys(payload, CONFIGURATION_KEYS) || payload.schemaVersion !== 1) {
    throw new Error("N-2 soak configuration has the wrong shape.");
  }
  if (payload.mode === "literal") {
    if (!equalLiteralConfiguration(payload)) {
      throw new Error("Literal N-2 configuration must use the immutable literal one-hour settings.");
    }
    return payload;
  }
  if (
    payload.mode !== "accelerated"
    || payload.releaseEvidenceEligible !== false
    || payload.evidenceLabel !== "ACCELERATED-NON-RELEASE"
  ) throw new Error("Accelerated N-2 configuration must be explicitly non-release.");
  if (
    !positiveInteger(payload.durationSeconds)
    || payload.durationSeconds > 3_600
    || !positiveInteger(payload.cadenceMilliseconds)
    || payload.cadenceMilliseconds > 60_000
    || !Number.isSafeInteger(payload.warmupSeconds)
    || payload.warmupSeconds < 0
    || !Number.isSafeInteger(payload.baselineStartSeconds)
    || payload.baselineStartSeconds < payload.warmupSeconds
    || !positiveInteger(payload.baselineEndSeconds)
    || payload.baselineEndSeconds <= payload.baselineStartSeconds
    || payload.baselineEndSeconds >= payload.durationSeconds
    || !positiveInteger(payload.crashAtSeconds)
    || payload.crashAtSeconds <= payload.baselineEndSeconds
    || payload.crashAtSeconds >= payload.durationSeconds
    || !positiveInteger(payload.minimumSuccessfulCycles)
    || !positiveInteger(payload.memorySampleIntervalSeconds)
    || !positiveInteger(payload.rollingWindowSamples)
    || !positiveInteger(payload.finalWindowSamples)
    || payload.thresholdRatio !== 1.5
  ) throw new Error("Accelerated N-2 non-release timing configuration is invalid.");
  if (Math.ceil(payload.durationSeconds * 1_000 / payload.cadenceMilliseconds) > 900) {
    throw new Error("Accelerated N-2 controls exceed the bounded Console capacity.");
  }
  return payload;
}

export function isLiteralN2ReleaseEvidence(payload) {
  try {
    validateN2SoakConfiguration(payload);
    return equalLiteralConfiguration(payload);
  } catch {
    return false;
  }
}

export function validateN2CrashTiming({ crashElapsedSeconds, recoveryElapsedSeconds }, configuration) {
  const config = validateN2SoakConfiguration(configuration);
  if (
    config.mode === "disabled"
    || typeof crashElapsedSeconds !== "number"
    || !Number.isFinite(crashElapsedSeconds)
    || typeof recoveryElapsedSeconds !== "number"
    || !Number.isFinite(recoveryElapsedSeconds)
    || crashElapsedSeconds < config.crashAtSeconds
    || crashElapsedSeconds > config.crashAtSeconds + 90
    || recoveryElapsedSeconds < crashElapsedSeconds
    || recoveryElapsedSeconds - crashElapsedSeconds > 90
  ) throw new Error("N-2 crash/recovery timing is invalid.");
  return { crashElapsedSeconds, recoveryElapsedSeconds };
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("Median requires samples.");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function validateMemorySample(sample, priorElapsedSeconds) {
  if (
    !exactKeys(sample, ["elapsedSeconds", "privateBytes", "workingSetBytes"])
    || typeof sample.elapsedSeconds !== "number"
    || !Number.isFinite(sample.elapsedSeconds)
    || sample.elapsedSeconds < 0
    || sample.elapsedSeconds <= priorElapsedSeconds
    || !Number.isSafeInteger(sample.privateBytes)
    || sample.privateBytes <= 0
    || !Number.isSafeInteger(sample.workingSetBytes)
    || sample.workingSetBytes <= 0
  ) throw new Error("N-2 memory samples must be positive, finite, and chronological.");
}

export function summarizeN2Memory(samples, configuration) {
  const config = validateN2SoakConfiguration(configuration);
  if (config.mode === "disabled") throw new Error("Disabled N-2 configuration has no memory summary.");
  if (!Array.isArray(samples)) throw new Error("N-2 memory samples must be an array.");
  let priorElapsedSeconds = -1;
  for (const sample of samples) {
    validateMemorySample(sample, priorElapsedSeconds);
    priorElapsedSeconds = sample.elapsedSeconds;
  }
  const baselineSamples = samples.filter(({ elapsedSeconds }) => (
    elapsedSeconds >= config.baselineStartSeconds && elapsedSeconds <= config.baselineEndSeconds
  ));
  if (baselineSamples.length < config.rollingWindowSamples) {
    throw new Error("N-2 memory baseline does not contain enough samples.");
  }
  const postBaseline = samples.filter(({ elapsedSeconds }) => elapsedSeconds > config.baselineEndSeconds);
  if (postBaseline.length < Math.max(config.rollingWindowSamples, config.finalWindowSamples)) {
    throw new Error("N-2 memory result does not contain enough post-baseline samples.");
  }
  const baselineBytes = median(baselineSamples.map(({ privateBytes }) => privateBytes));
  const thresholdBytes = Math.floor(baselineBytes * config.thresholdRatio);
  const rollingMedians = [];
  for (let index = config.rollingWindowSamples; index <= postBaseline.length; index += 1) {
    rollingMedians.push(median(
      postBaseline.slice(index - config.rollingWindowSamples, index).map(({ privateBytes }) => privateBytes),
    ));
  }
  const rollingMedianMaxBytes = Math.max(...rollingMedians);
  const finalMedianBytes = median(
    postBaseline.slice(-config.finalWindowSamples).map(({ privateBytes }) => privateBytes),
  );
  const rawMaxBytes = Math.max(...samples.map(({ privateBytes }) => privateBytes));
  const gaps = samples.slice(1).map((sample, index) => sample.elapsedSeconds - samples[index].elapsedSeconds);
  return {
    metric: "aggregate-private-bytes",
    sampleCount: samples.length,
    firstElapsedSeconds: samples[0].elapsedSeconds,
    lastElapsedSeconds: samples.at(-1).elapsedSeconds,
    maximumGapSeconds: Math.max(0, ...gaps),
    baselineSampleCount: baselineSamples.length,
    baselineFirstElapsedSeconds: baselineSamples[0].elapsedSeconds,
    baselineLastElapsedSeconds: baselineSamples.at(-1).elapsedSeconds,
    baselineBytes,
    thresholdBytes,
    finalMedianBytes,
    rollingMedianMaxBytes,
    rawMaxBytes,
    finalRatio: finalMedianBytes / baselineBytes,
    memoryGrowthPassed: rawMaxBytes <= thresholdBytes
      && rollingMedianMaxBytes <= thresholdBytes
      && finalMedianBytes <= thresholdBytes,
  };
}

function validateProcessRow(row) {
  if (
    !exactKeys(row, ["path", "pid", "privateBytes", "startedAt", "workingSetBytes"])
    || !positiveInteger(row.pid)
    || typeof row.path !== "string"
    || row.path.length === 0
    || !Number.isFinite(Date.parse(row.startedAt))
    || !Number.isSafeInteger(row.privateBytes)
    || row.privateBytes < 0
    || !Number.isSafeInteger(row.workingSetBytes)
    || row.workingSetBytes < 0
  ) throw new Error("N-2 process memory row is invalid.");
  return row;
}

export function aggregateN2ProcessMemory({ applicationProcesses, webViewProcesses, expectedGuiIdentity }) {
  if (!Array.isArray(applicationProcesses) || applicationProcesses.length !== 1) {
    throw new Error("N-2 memory sampling requires exactly one GUI process with MCP off.");
  }
  if (!Array.isArray(webViewProcesses) || webViewProcesses.length === 0) {
    throw new Error("N-2 memory sampling requires at least one WebView process.");
  }
  const application = applicationProcesses.map(validateProcessRow);
  const webView = webViewProcesses.map(validateProcessRow);
  const all = [...application, ...webView];
  if (new Set(all.map(({ pid }) => pid)).size !== all.length) {
    throw new Error("N-2 process identities must be unique.");
  }
  const gui = application[0];
  if (
    !record(expectedGuiIdentity)
    || gui.pid !== expectedGuiIdentity.pid
    || gui.path !== expectedGuiIdentity.path
    || gui.startedAt !== expectedGuiIdentity.startedAt
  ) throw new Error("N-2 GUI process identity changed during the soak.");
  return {
    privateBytes: all.reduce((total, row) => total + row.privateBytes, 0),
    workingSetBytes: all.reduce((total, row) => total + row.workingSetBytes, 0),
    applicationProcessCount: application.length,
    webViewProcessCount: webView.length,
    application,
    webView,
  };
}

export function advanceN2Continuity(state, cycle) {
  const current = state ?? {
    attempted: 0,
    successful: 0,
    unexpectedFailures: 0,
    firstStartedAtMs: cycle?.startedAtMs,
    lastCompletedAtMs: 0,
    maximumStartGapMs: 0,
    previousStartedAtMs: null,
  };
  if (
    !record(cycle)
    || cycle.sequence !== current.attempted + 1
    || !Number.isSafeInteger(cycle.startedAtMs)
    || !Number.isSafeInteger(cycle.completedAtMs)
    || cycle.completedAtMs < cycle.startedAtMs
    || typeof cycle.passed !== "boolean"
  ) throw new Error("N-2 cycles must be valid and sequential.");
  const gap = current.previousStartedAtMs === null ? 0 : cycle.startedAtMs - current.previousStartedAtMs;
  if (gap < 0) throw new Error("N-2 cycle start times must be chronological.");
  return {
    attempted: current.attempted + 1,
    successful: current.successful + (cycle.passed ? 1 : 0),
    unexpectedFailures: current.unexpectedFailures + (cycle.passed ? 0 : 1),
    firstStartedAtMs: current.firstStartedAtMs,
    lastCompletedAtMs: cycle.completedAtMs,
    maximumStartGapMs: Math.max(current.maximumStartGapMs, gap),
    previousStartedAtMs: cycle.startedAtMs,
  };
}

export async function appendN2JsonLine(path, payload, {
  maximumLineBytes = 8 * 1_024,
  maximumFileBytes = 8 * 1_024 * 1_024,
} = {}) {
  if (!positiveInteger(maximumLineBytes) || !positiveInteger(maximumFileBytes)) {
    throw new Error("N-2 JSONL budgets must be positive integers.");
  }
  let serialized;
  try {
    serialized = `${JSON.stringify(payload)}\n`;
  } catch (error) {
    throw new Error("N-2 JSONL payload is not JSON-compatible.", { cause: error });
  }
  const lineBytes = Buffer.byteLength(serialized);
  if (lineBytes > maximumLineBytes) throw new Error("N-2 JSONL line budget exceeded.");
  let existingBytes = 0;
  try {
    existingBytes = (await stat(path)).size;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existingBytes + lineBytes > maximumFileBytes) throw new Error("N-2 JSONL file budget exceeded.");
  await appendFile(path, serialized, { encoding: "utf8", flag: "a" });
  return { lineBytes, fileBytes: existingBytes + lineBytes };
}

export function validateN2SoakSummary(payload, { requireReleaseEvidence = false } = {}) {
  if (!record(payload) || payload.schemaVersion !== 1 || payload.status !== "passed") {
    throw new Error("N-2 soak summary is not a passing evidence record.");
  }
  const config = validateN2SoakConfiguration(payload.configuration);
  if (requireReleaseEvidence && !isLiteralN2ReleaseEvidence(config)) {
    throw new Error("Summary is not literal N-2 release evidence.");
  }
  if (isLiteralN2ReleaseEvidence(config) && payload.durationSeconds < 3_600) {
    throw new Error("Literal N-2 evidence must cover one continuous hour.");
  }
  if (
    typeof payload.durationSeconds !== "number"
    || !Number.isFinite(payload.durationSeconds)
    || payload.durationSeconds < config.durationSeconds
  ) {
    throw new Error("N-2 soak summary does not cover its declared duration.");
  }
  if (
    !record(payload.cycles)
    || !positiveInteger(payload.cycles.attempted)
    || !Number.isSafeInteger(payload.cycles.successful)
    || payload.cycles.successful < 0
    || payload.cycles.successful < config.minimumSuccessfulCycles
    || payload.cycles.expectedCrashFailures !== 1
    || payload.cycles.unexpectedFailures !== 0
    || payload.cycles.attempted !== payload.cycles.successful + payload.cycles.expectedCrashFailures
    || !record(payload.continuity)
    || !Number.isSafeInteger(payload.continuity.maximumStartGapMs)
    || payload.continuity.maximumStartGapMs < 0
    || payload.continuity.maximumStartGapMs > 90_000
    || payload.continuity.overlappingRequests !== 0
    || !record(payload.memory)
    || payload.memory.memoryGrowthPassed !== true
    || !record(payload.crashProbe)
    || !["attempted", "engineKilled", "guiIdentityPreserved", "engineCleared", "recoveryCyclePassed"]
      .every((key) => payload.crashProbe[key] === true)
    || payload.orphans?.passed !== true
    || !positiveInteger(payload.samples?.recordCount)
    || !positiveInteger(payload.samples?.memorySampleCount)
    || payload.samples.memorySampleCount !== payload.memory.sampleCount
    || payload.samples.recordCount !== payload.cycles.attempted + payload.samples.memorySampleCount
    || !/^[a-f0-9]{64}$/iu.test(payload.samples?.sha256 ?? "")
  ) throw new Error("N-2 soak summary does not satisfy its declared acceptance criteria.");
  const allowedGapSeconds = config.memorySampleIntervalSeconds + config.cadenceMilliseconds / 1_000;
  const memory = payload.memory;
  const coverageValues = [
    memory.firstElapsedSeconds,
    memory.lastElapsedSeconds,
    memory.maximumGapSeconds,
    memory.baselineFirstElapsedSeconds,
    memory.baselineLastElapsedSeconds,
  ];
  if (
    !positiveInteger(memory.sampleCount)
    || !coverageValues.every((value) => typeof value === "number" && Number.isFinite(value))
    || !positiveInteger(memory.baselineSampleCount)
    || memory.baselineSampleCount < config.rollingWindowSamples
    || memory.baselineSampleCount > memory.sampleCount
    || memory.firstElapsedSeconds !== memory.baselineFirstElapsedSeconds
    || memory.baselineFirstElapsedSeconds < config.baselineStartSeconds
    || memory.baselineFirstElapsedSeconds > config.baselineStartSeconds + allowedGapSeconds
    || memory.baselineLastElapsedSeconds < config.baselineEndSeconds - allowedGapSeconds
    || memory.baselineLastElapsedSeconds > config.baselineEndSeconds
    || memory.lastElapsedSeconds < memory.baselineLastElapsedSeconds
    || Math.abs(memory.lastElapsedSeconds - payload.durationSeconds) > config.memorySampleIntervalSeconds
    || memory.maximumGapSeconds <= 0
    || memory.maximumGapSeconds > allowedGapSeconds
    || memory.sampleCount < Math.ceil(
      (memory.lastElapsedSeconds - memory.firstElapsedSeconds) / allowedGapSeconds,
    ) + 1
    || memory.baselineSampleCount < Math.ceil(
      (memory.baselineLastElapsedSeconds - memory.baselineFirstElapsedSeconds) / allowedGapSeconds,
    ) + 1
  ) throw new Error("N-2 memory coverage does not span the declared soak.");
  return payload;
}
